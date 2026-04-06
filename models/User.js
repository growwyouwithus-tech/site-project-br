/**
 * User Model (Admin & Site Managers)
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: 6
    },
    role: {
        type: String,
        enum: ['admin', 'sitemanager'],
        default: 'sitemanager'
    },
    phone: {
        type: String,
        trim: true
    },
    salary: {
        type: Number,
        default: 0
    },
    walletBalance: {
        type: Number,
        default: 0
    },
    dateOfJoining: {
        type: Date,
        default: Date.now
    },
    assignedSites: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
    }],
    active: {
        type: Boolean,
        default: true
    },
    userId: {
        type: String,
        unique: true
    }
}, {
    timestamps: true
});

// Add indexes for frequent queries
userSchema.index({ role: 1, active: 1 });
// userSchema.index({ email: 1 }); // Removed: duplicate of unique: true

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

// Generate userId before saving
userSchema.pre('save', function (next) {
    if (!this.userId) {
        const prefix = 'USR';
        const timestamp = Date.now().toString().slice(-6);
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        this.userId = `${prefix}${timestamp}${random}`;
    }
    next();
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
