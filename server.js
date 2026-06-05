/**
 * Construction Site Management System - Backend Server
 * Now with MongoDB for persistent data storage
 */

require('dotenv').config();
const express = require('express'); // Trigger restart
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const http = require('http');
const compression = require('compression');
const socketIO = require('socket.io');
const multer = require('multer');
const fs = require('fs');
// Import MongoDB connection with fallback
const connectDB = require('./config/database-fallback');

// Connect to MongoDB
connectDB();

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const siteRoutes = require('./routes/site');

// Import middleware
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Initialize express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIO(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Store io instance in app for use in controllers
app.set('io', io);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('✅ Created uploads directory');
}

// ============ MIDDLEWARE ============

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Compress all responses
app.use(compression());

// CORS configuration
// CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) === -1) {
      // Check if it matches any local dev regex if needed, or just allow all localhost for dev
      if (process.env.NODE_ENV === 'development' && origin.includes('localhost')) {
        return callback(null, true);
      }
      var msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

// Body parser
app.use(express.json({ limit: '50mb' })); // Support base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session configuration (IN-MEMORY - will be lost on restart)
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-super-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
  // NOTE: Using default MemoryStore - data lost on restart
  // To persist sessions, use connect-mongo:
  // store: MongoStore.create({ mongoUrl: 'mongodb://localhost/sessions' })
}));

// Serve static files from uploads directory
app.use('/uploads', express.static(uploadsDir));

// ============ FILE UPLOAD CONFIGURATION ============

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const fileUrl = `/uploads/${req.file.filename}`;

    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        filename: req.file.filename,
        url: fileUrl,
        path: req.file.path
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Multiple file upload endpoint
app.post('/api/upload-multiple', upload.array('files', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    const files = req.files.map(file => ({
      filename: file.filename,
      url: `/uploads/${file.filename}`,
      path: file.path
    }));

    res.json({
      success: true,
      message: 'Files uploaded successfully',
      data: files
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============ ROUTES ============

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    warning: 'Using in-memory storage - data will be lost on restart'
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/site', siteRoutes);

// Migration Route
app.get('/api/migrate', async (req, res) => {
  try {
    const Contractor = require('./models/Contractor');
    const contractors = await Contractor.find({});
    let count = 0;
    for (const contractor of contractors) {
        if (contractor.activeAssignments.length === 0 && contractor.assignedProjects && contractor.assignedProjects.length > 0) {
            const legacyDistance = contractor.distanceValue || 0;
            const legacyUnit = contractor.distanceUnit || 'km';
            const legacyExpense = contractor.expensePerUnit || 0;
            const legacyTotalPaid = contractor.totalPaid || 0;
            const legacyAdvance = contractor.advancePayment || 0;
            const legacyAssignedAt = contractor.projectAssignedAt || contractor.createdAt;

            contractor.activeAssignments.push({
                projectId: contractor.assignedProjects[0],
                assignedAt: legacyAssignedAt,
                distanceValue: legacyDistance,
                distanceUnit: legacyUnit,
                expensePerUnit: legacyExpense,
                totalPaid: legacyTotalPaid,
                advancePayment: legacyAdvance
            });

            for (let i = 1; i < contractor.assignedProjects.length; i++) {
                contractor.activeAssignments.push({
                    projectId: contractor.assignedProjects[i],
                    assignedAt: legacyAssignedAt,
                    distanceValue: 0,
                    distanceUnit: 'km',
                    expensePerUnit: 0,
                    totalPaid: 0,
                    advancePayment: 0
                });
            }
            await contractor.save();
            count++;
        }
    }
    res.json({ migrated: count });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// ============ SOCKET.IO CONFIGURATION ============

// Store connected users (userId -> socketId mapping)
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log('🔌 New socket connection:', socket.id);

  // User joins with their userId
  socket.on('join', (userId) => {
    connectedUsers.set(userId, socket.id);
    socket.join(userId); // Join room with userId
    console.log(`👤 User ${userId} joined with socket ${socket.id}`);
  });

  // Connect to MongoDB
  connectDB();

  // Debug contractor and site manager, and UPDATE admin credentials
  const mongoose = require('mongoose');
  mongoose.connection.once('open', async () => {
    try {
      const db = mongoose.connection.db;
      // Auto update admin credentials as requested
      await db.collection('users').updateOne(
        { role: 'admin' },
        { $set: { email: 'AK.construction.hts@gmail.com', password: 'Ankit@3004' } }
      );
      
      const fs = require('fs');
      const contractors = await db.collection('contractors').find({ name: /parvesh/i }).toArray();
      const users = await db.collection('users').find({ role: 'sitemanager' }).toArray();
      fs.writeFileSync('debug.json', JSON.stringify({
        contractors,
        siteManagers: users.map(u => ({ email: u.email, assignedSites: u.assignedSites }))
      }, null, 2));
      console.log('✅ Admin credentials updated and Debug written to debug.json');
    } catch (e) {
      console.error('Debug error:', e);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    // Remove user from connected users
    for (const [userId, socketId] of connectedUsers.entries()) {
      if (socketId === socket.id) {
        connectedUsers.delete(userId);
        console.log(`👤 User ${userId} disconnected`);
        break;
      }
    }
  });

  // Test notification
  socket.on('test-notification', (data) => {
    console.log('📢 Test notification received:', data);
    socket.emit('notification', {
      message: 'Test notification',
      type: 'test',
      timestamp: new Date()
    });
  });
});

// ============ START SERVER ============

const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log('\n🚀 ============================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('🚀 ============================================');
    console.log('\n✅ Using MongoDB for persistent storage!');
    console.log('✅ Data will be saved permanently in database.\n');
    console.log('📌 API Endpoints:');
    console.log(`   - Health: http://localhost:${PORT}/api/health`);
    console.log(`   - Auth: http://localhost:${PORT}/api/auth/*`);
    console.log(`   - Admin: http://localhost:${PORT}/api/admin/*`);
    console.log(`   - Site Manager: http://localhost:${PORT}/api/site/*`);
    console.log(`   - File Upload: http://localhost:${PORT}/api/upload`);
    console.log(`   - Static Files: http://localhost:${PORT}/uploads/*`);
    console.log('\n🔐 Default Credentials:');
    console.log('   Admin: AK.construction.hts@gmail.com / Ankit@3004');
    console.log('   Site Manager: rajesh@construction.com / manager123');
    console.log('\n============================================\n');

    // Disable console.log after startup to prevent log spam from controllers
    console.log = () => { };
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Promise Rejection:', err);
  // Don't exit in development
  if (process.env.NODE_ENV === 'production') {
    server.close(() => process.exit(1));
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  // Don't exit in development
  if (process.env.NODE_ENV === 'production') {
    server.close(() => process.exit(1));
  }
});

module.exports = { app, server, io };
// Restart Trigger 2
