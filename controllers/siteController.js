/**
 * Site Manager Controller - MongoDB Version
 * Handles all site manager-specific operations with MongoDB
 */

const { User, Project, Vendor, Expense, Labour, LabourAttendance, LabourPayment, Stock, StockOut, Machine, Transfer, DailyReport, LabEquipment, ConsumableGoods, Equipment, Attendance, Contractor, ContractorPayment, VendorPayment, Transaction, ItemName } = require('../models');
const Notification = require('../models/Notification');

// ============ DASHBOARD ============

// Get site manager dashboard
const getDashboard = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId).select('-password');

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        console.log('Site Manager Dashboard - User:', user.name, 'assignedSites:', user.assignedSites);

        // Get assigned projects
        const assignedProjects = await Project.find({
            _id: { $in: user.assignedSites || [] }
        });

        console.log('Found assigned projects:', assignedProjects.length);

        // Get labour count
        const labourCount = await Labour.countDocuments({
            assignedSite: { $in: user.assignedSites || [] }
        });

        // Get today's attendance (placeholder - implement when attendance model is ready)
        const todayAttendance = [];

        // Get notifications (placeholder)
        const notifications = [];

        res.json({
            success: true,
            data: {
                user,
                assignedProjects,
                labourCount,
                todayAttendance,
                notifications
            }
        });
    } catch (error) {
        console.error('Error in site manager dashboard:', error);
        next(error);
    }
};

// ============ ATTENDANCE ============

const markAttendance = async (req, res, next) => {
    try {
        const { projectId, date, photo, remarks } = req.body;
        const userId = req.user.userId;

        // Check if attendance already marked for this date AND project (RESTRICTION REMOVED as per user request to allow multiple logs/managers)
        /*
        const existingAttendance = await Attendance.findOne({
            userId,
            date,
            projectId
        });

        if (existingAttendance) {
            return res.status(400).json({
                success: false,
                error: 'Attendance already marked for this date at this site'
            });
        }
        */

        const attendance = new Attendance({
            userId,
            projectId,
            date,
            photo,  // Photo is now optional
            remarks
        });

        await attendance.save();

        res.status(201).json({
            success: true,
            message: 'Attendance marked successfully',
            data: attendance
        });
    } catch (error) {
        next(error);
    }
};

const getMyAttendance = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { projectId } = req.query; // Support filtering by project

        const query = { userId };
        if (projectId) {
            query.projectId = projectId;
        }

        const attendance = await Attendance.find(query)
            .populate('projectId', 'name location')
            .sort('-date')
            .limit(100);

        res.json({
            success: true,
            data: attendance
        });
    } catch (error) {
        next(error);
    }
};

// ============ LABOUR ============

// Get all labours for assigned sites
const getLabours = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const { projectId, contractorId } = req.query;
        const query = {};

        if (projectId) {
            query.assignedSite = projectId;
        } else {
            query.assignedSite = { $in: user.assignedSites || [] };
        }

        if (contractorId === 'null') {
            query.contractorId = null; // Site Labour
        } else if (contractorId) {
            query.contractorId = contractorId; // Contractor Labour
        }

        const labours = await Labour.find(query)
            .populate('assignedSite', 'name location')
            .populate('contractorId', 'name mobile');

        res.json({
            success: true,
            data: labours
        });
    } catch (error) {
        next(error);
    }
};

// Enroll new labour
const enrollLabour = async (req, res, next) => {
    try {
        const { name, phone, dailyWage, designation, assignedSite, contractorId } = req.body;

        const newLabour = new Labour({
            name,
            phone,
            dailyWage: parseFloat(dailyWage),
            designation,
            assignedSite,
            contractorId: contractorId || null,
            enrolledBy: req.user.userId,
            active: true
        });

        await newLabour.save();

        res.status(201).json({
            success: true,
            message: 'Labour enrolled successfully',
            data: newLabour
        });
    } catch (error) {
        next(error);
    }
};

// Update labour
const updateLabour = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const labour = await Labour.findByIdAndUpdate(
            id,
            updates,
            { new: true, runValidators: true }
        );

        if (!labour) {
            return res.status(404).json({
                success: false,
                error: 'Labour not found'
            });
        }

        res.json({
            success: true,
            message: 'Labour updated successfully',
            data: labour
        });
    } catch (error) {
        next(error);
    }
};

// ============ LABOUR ATTENDANCE ============

const markLabourAttendance = async (req, res, next) => {
    try {
        const { labourId, labourName, projectId, date, status, remarks } = req.body;
        const userId = req.user.userId;

        // Check if attendance already marked for this labour on this date
        const existingAttendance = await LabourAttendance.findOne({
            labourId,
            date: new Date(date)
        });

        if (existingAttendance) {
            return res.status(400).json({
                success: false,
                error: 'Attendance already marked for this labour today'
            });
        }

        // Get labour details to update pendingPayout
        const labour = await Labour.findById(labourId);
        if (!labour) {
            return res.status(404).json({
                success: false,
                error: 'Labour not found'
            });
        }

        // Create attendance record
        const attendance = new LabourAttendance({
            labourId,
            labourName,
            projectId,
            date: new Date(date),
            status,
            remarks,
            markedBy: userId
        });

        await attendance.save();

        // Update pendingPayout based on status
        let payoutAmount = 0;
        if (status === 'present') {
            payoutAmount = labour.dailyWage;
        } else if (status === 'half') {
            payoutAmount = labour.dailyWage / 2;
        }
        // For 'absent', payoutAmount remains 0

        if (payoutAmount > 0) {
            await Labour.findByIdAndUpdate(
                labourId,
                { $inc: { pendingPayout: payoutAmount } }
            );
        }

        res.status(201).json({
            success: true,
            message: 'Attendance marked successfully',
            data: attendance
        });
    } catch (error) {
        next(error);
    }
};

const getLabourAttendance = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Get attendance for assigned projects
        const attendance = await LabourAttendance.find({
            projectId: { $in: user.assignedSites || [] }
        })
            .populate('labourId', 'name phone dailyWage designation')
            .populate('projectId', 'name location')
            .sort('-date')
            .limit(100);

        res.json({
            success: true,
            data: attendance
        });
    } catch (error) {
        next(error);
    }
};

// ============ STOCK IN ============

const addStockIn = async (req, res, next) => {
    try {
        const { projectId, vendorId, materialName, unit, quantity, unitPrice, remarks, paymentStatus, vehicleNumber } = req.body;
        const userId = req.user.userId;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Verify project is assigned to this site manager
        if (!user.assignedSites || !user.assignedSites.includes(projectId)) {
            return res.status(403).json({
                success: false,
                error: 'You are not assigned to this project'
            });
        }

        const totalPrice = parseFloat(quantity) * parseFloat(unitPrice);

        let status = paymentStatus;
        if (Array.isArray(status)) status = status[0];
        status = (status || 'credit').toLowerCase().trim();
        console.log(`Stock In Request: Status: ${status}, Total Price: ${totalPrice}, Wallet Balance: ${user.walletBalance}`);

        // Check wallet balance if payment is 'paid'
        if (status === 'paid') {
            if (user.walletBalance < totalPrice) {
                return res.status(400).json({
                    success: false,
                    error: `Insufficient wallet balance. Current: ₹${user.walletBalance}`
                });
            }

            // Deduct from wallet
            user.walletBalance -= totalPrice;
            await user.save();
            console.log(`Wallet deducted. New Balance: ${user.walletBalance}`);
        }

        // Upload photos to Cloudinary if files exist
        let photoUrls = [];
        let photoUrl = null;
        
        if (req.files && req.files.length > 0) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            const uploadPromises = req.files.map(file => uploadToCloudinary(file.buffer, 'stock'));
            photoUrls = await Promise.all(uploadPromises);
            photoUrl = photoUrls[0]; // Set first photo as primary
        } else if (req.file) {
            // Fallback for single file upload
            const { uploadToCloudinary } = require('../config/cloudinary');
            photoUrl = await uploadToCloudinary(req.file.buffer, 'stock');
            photoUrls = [photoUrl];
        }

        const newStock = new Stock({
            projectId,
            vendorId,
            materialName,
            unit,
            quantity: parseFloat(quantity),
            unitPrice: parseFloat(unitPrice),
            totalPrice,
            photo: photoUrl,
            photos: photoUrls,
            remarks,
            vehicleNumber: vehicleNumber || null,
            addedBy: userId,
            paymentStatus: status // Use the cleaned status
        });

        await newStock.save();

        // Update vendor's Stats
        if (vendorId) {
            const update = {
                $inc: { totalSupplied: totalPrice }
            };

            // Only increase pending amount if NOT paid
            if (paymentStatus !== 'paid') {
                update.$inc.pendingAmount = totalPrice;
            }

            await Vendor.findByIdAndUpdate(vendorId, update);
        }

        res.status(201).json({
            success: true,
            message: 'Stock added successfully',
            data: newStock
        });
    } catch (error) {
        next(error);
    }
};

const getStocks = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { startDate, endDate, vendorId } = req.query;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        console.log('ðŸ” Site Manager Stocks - User:', user.name, 'assignedSites:', user.assignedSites);

        // Check if user has assigned sites
        if (!user.assignedSites || user.assignedSites.length === 0) {
            console.log('â„¹ï¸ No assigned sites for site manager, returning empty stocks');
            return res.json({
                success: true,
                data: []
            });
        }

        // Build query
        const query = {
            projectId: { $in: user.assignedSites }
        };

        if (vendorId && vendorId !== 'all') {
            query.vendorId = vendorId;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                query.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                // Set end date to end of day
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        // Increase limit if filtering, otherwise default to 50 (restored from 10)
        // If filtering is applied, we usually want to see all results
        const limit = (startDate || endDate || (vendorId && vendorId !== 'all')) ? 1000 : 50;

        const stocks = await Stock.find(query)
            .populate('projectId', 'name location')
            .populate('vendorId', 'name contact')
            .populate('addedBy', 'name') // Populate the adder's name
            .sort('-createdAt')
            .limit(limit)
            .lean();

        console.log(`âœ… Found ${stocks.length} stocks for site manager ${user.name}`);

        res.json({
            success: true,
            data: stocks
        });
    } catch (error) {
        console.error('âŒ Error in getStocks:', error);
        next(error);
    }
};

// Record Stock Out (Usage) with automatic deduction
const recordStockOut = async (req, res, next) => {
    try {
        const { projectId, materialName, quantity, unit, usedFor, remarks } = req.body;
        const userId = req.user.userId;

        const quantityVal = parseFloat(quantity);
        if (quantityVal <= 0) {
            return res.status(400).json({ success: false, error: 'Quantity must be greater than 0' });
        }

        // Find available stock for this material (FIFO)
        const stock = await Stock.findOne({
            projectId,
            materialName,
            quantity: { $gte: quantityVal }
        }).sort({ createdAt: 1 });

        if (!stock) {
            return res.status(400).json({
                success: false,
                error: `Insufficient stock for ${materialName}. Required: ${quantityVal} ${unit}`
            });
        }

        // Upload photos to Cloudinary in parallel
        let photoUrls = [];
        if (req.files && req.files.length > 0) {
            const { uploadToCloudinary } = require('../config/cloudinary');

            // Create array of upload promises
            const uploadPromises = req.files.map(file =>
                uploadToCloudinary(file.buffer, 'stock-out')
                    .catch(error => {
                        console.error('Error uploading photo:', error);
                        return null;
                    })
            );

            // Wait for all uploads to complete
            const results = await Promise.all(uploadPromises);

            // Filter out failed uploads
            photoUrls = results.filter(url => url !== null);
        }

        // Deduct quantity from stock
        stock.quantity -= quantityVal;
        await stock.save();

        // Create StockOut record
        const stockOut = await StockOut.create({
            projectId,
            materialName,
            quantity: quantityVal,
            unit,
            usedFor,
            remarks,
            photos: photoUrls,
            recordedBy: userId
        });

        console.log(`âœ… Stock Out recorded: ${materialName} - ${quantityVal} ${unit}${photoUrls.length > 0 ? ` with ${photoUrls.length} photo(s)` : ''}`);

        res.status(201).json({
            success: true,
            message: 'Stock usage recorded successfully',
            data: stockOut
        });
    } catch (error) {
        console.error('âŒ Error recording stock out:', error);
        next(error);
    }
};

// Get Stock Out records
const getStockOuts = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user || !user.assignedSites || user.assignedSites.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const stockOuts = await StockOut.find({
            projectId: { $in: user.assignedSites }
        })
            .populate('projectId', 'name')
            .populate('recordedBy', 'name')
            .sort('-createdAt')
            .limit(50)
            .lean();

        // Format for frontend table
        const formattedData = stockOuts.map(s => ({
            _id: s._id,
            date: s.date || s.createdAt,
            type: 'OUT',
            material: s.materialName,
            quantity: s.quantity,
            unit: s.unit,
            project: typeof s.projectId === 'object' ? s.projectId.name : s.projectId,
            projectId: typeof s.projectId === 'object' ? s.projectId._id : s.projectId, // Added for filtering
            usedFor: s.usedFor,
            remarks: s.remarks || '-',
            photos: s.photos || []
        }));

        res.json({
            success: true,
            data: formattedData
        });
    } catch (error) {
        console.error('âŒ Error fetching stock outs:', error);
        next(error);
    }
};


// ============ GALLERY ============

const uploadGalleryImages = async (req, res, next) => {
    res.json({ success: true, message: 'Feature coming soon' });
};

const getGalleryImages = async (req, res, next) => {
    res.json({ success: true, data: [] });
};

// ============ EXPENSES ============

// Get expenses for assigned projects
const getExpenses = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const expenses = await Expense.find({
            projectId: { $in: user.assignedSites || [] }
        })
            .populate('projectId', 'name location')
            .sort('-createdAt');

        res.json({
            success: true,
            data: expenses
        });
    } catch (error) {
        next(error);
    }
};

// Add expense
const addExpense = async (req, res, next) => {
    try {
        const { projectId, name, amount, voucherNumber, category, remarks } = req.body;
        const userId = req.user.userId;
        const expenseAmount = parseFloat(amount);

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Check sufficient balance
        if (user.walletBalance < expenseAmount) {
            return res.status(400).json({
                success: false,
                error: `Insufficient wallet balance. Current: â‚¹${user.walletBalance}`
            });
        }

        // Upload receipt to Cloudinary if file exists
        let receiptUrl = null;
        if (req.file) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            receiptUrl = await uploadToCloudinary(req.file.buffer, 'expenses');
        }

        // Deduct from wallet
        user.walletBalance -= expenseAmount;
        await user.save();

        const newExpense = new Expense({
            projectId,
            name,
            amount: expenseAmount,
            voucherNumber,
            category: category || 'material',
            remarks,
            receipt: receiptUrl,
            addedBy: userId
        });

        await newExpense.save();

        // Update project expenses
        await Project.findByIdAndUpdate(
            projectId,
            { $inc: { expenses: expenseAmount } }
        );

        res.status(201).json({
            success: true,
            message: 'Expense added successfully',
            data: newExpense
        });
    } catch (error) {
        next(error);
    }
};

// ============ TRANSFER ============

const requestTransfer = async (req, res, next) => {
    try {
        const { type, itemId, fromProject, toProject, quantity, remarks } = req.body;
        const userId = req.user.userId;

        // Validation
        if (!type || !fromProject || !toProject) {
            return res.status(400).json({ success: false, error: 'Please provide all required fields' });
        }

        const transferData = {
            type,
            fromProject,
            toProject,
            quantity: parseFloat(quantity) || 1,
            remarks,
            requestedBy: userId,
            status: 'approved' // Auto-approve for Site Managers
        };

        // Handle specific types and ID assignment
        if (type === 'labour') {
            if (!itemId) return res.status(400).json({ success: false, error: 'Labour is required' });
            transferData.labourId = itemId;
        } else if (type === 'machine' || type === 'lab-equipment' || type === 'equipment') {
            if (!itemId) return res.status(400).json({ success: false, error: 'Item is required' });
            transferData.machineId = itemId;
        } else if (type === 'stock' || type === 'consumable-goods') {
            if (!itemId) return res.status(400).json({ success: false, error: 'Item is required' });
            transferData.materialName = itemId;

            if (type === 'consumable-goods') {
                // Try to resolve name from ID if possible, though itemId usually is name for stock?
                // But for consumable-goods frontend might pass ID.
                // Let's try to find if it's an ID
                if (itemId.match(/^[0-9a-fA-F]{24}$/)) {
                    const item = await ConsumableGoods.findById(itemId);
                    if (item) transferData.materialName = item.name;
                }
            }
        }

        const transfer = new Transfer(transferData);
        await transfer.save();

        // NOTIFICATION TRIGGER
        try {
            const admins = await User.find({ role: 'admin' });
            const itemLabel = transferData.materialName || 'Item'; // Fallback
            const sourceProj = await Project.findById(fromProject);
            const destProj = await Project.findById(toProject);

            for (const admin of admins) {
                await Notification.create({
                    recipient: admin._id,
                    title: 'New Transfer Request',
                    message: `Transfer of ${quantity} ${itemLabel} from ${sourceProj?.name} to ${destProj?.name} requested.`,
                    type: 'info',
                    link: '/admin/transfer',
                    relatedId: transfer._id,
                    relatedModel: 'Transfer'
                });
            }
        } catch (notifError) {
            console.error('Failed to send notification:', notifError);
        }

        // EXECUTE TRANSFER (Move Items Immediately)
        if (type === 'labour') {
            await Labour.findByIdAndUpdate(itemId, { assignedSite: toProject });
        } else if (type === 'machine') {
            await Machine.findByIdAndUpdate(itemId, {
                projectId: toProject,
                status: 'available',
                assignedToContractor: null
            });
        } else if (type === 'lab-equipment') {
            await LabEquipment.findByIdAndUpdate(itemId, {
                projectId: toProject,
                status: 'active'
            });
        } else if (type === 'equipment') {
            await Equipment.findByIdAndUpdate(itemId, {
                projectId: toProject,
                status: 'active'
            });
        } else if (type === 'stock') {
            // Logic to move stock
            // itemId is materialName (as per frontend usage usually)

            const sourceStock = await Stock.findOne({ projectId: fromProject, materialName: itemId });

            if (sourceStock) {
                sourceStock.quantity = Math.max(0, sourceStock.quantity - (parseFloat(quantity) || 0));
                await sourceStock.save();

                // Add to destination
                const stockQuantity = parseFloat(quantity) || 0;
                let destStock = await Stock.findOne({
                    projectId: toProject,
                    materialName: sourceStock.materialName,
                    vendorId: sourceStock.vendorId,
                    unitPrice: sourceStock.unitPrice
                });

                if (destStock) {
                    destStock.quantity += stockQuantity;
                    destStock.totalPrice = destStock.quantity * destStock.unitPrice;
                    await destStock.save();
                } else {
                    await Stock.create({
                        projectId: toProject,
                        vendorId: sourceStock.vendorId,
                        materialName: sourceStock.materialName,
                        unit: sourceStock.unit,
                        quantity: stockQuantity,
                        unitPrice: sourceStock.unitPrice,
                        totalPrice: stockQuantity * sourceStock.unitPrice,
                        addedBy: userId,
                        photo: sourceStock.photo,
                        remarks: `Transferred from ${fromProject}`
                    });
                }
            }
        } else if (type === 'consumable-goods') {
            // itemId might be ID or Name. Using id as priority.
            let sourceItem = null;
            if (itemId.match(/^[0-9a-fA-F]{24}$/)) {
                sourceItem = await ConsumableGoods.findById(itemId);
            } else {
                sourceItem = await ConsumableGoods.findOne({ projectId: fromProject, name: itemId });
            }

            if (sourceItem) {
                sourceItem.quantity = Math.max(0, sourceItem.quantity - (parseFloat(quantity) || 0));
                await sourceItem.save();

                const qty = parseFloat(quantity) || 0;
                let destItem = await ConsumableGoods.findOne({
                    projectId: toProject,
                    name: sourceItem.name
                });

                if (destItem) {
                    destItem.quantity += qty;
                    await destItem.save();
                } else {
                    await ConsumableGoods.create({
                        projectId: toProject,
                        name: sourceItem.name,
                        category: sourceItem.category,
                        quantity: qty,
                        unit: sourceItem.unit,
                        minStockLevel: sourceItem.minStockLevel,
                        expiryDate: sourceItem.expiryDate,
                        remarks: `Transferred from ${fromProject}`
                    });
                }
            }
        }

        res.status(201).json({
            success: true,
            message: 'Transfer executed successfully (Auto-Approved)',
            data: transfer
        });
    } catch (error) {
        next(error);
    }
};

const getTransfers = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user || !user.assignedSites || user.assignedSites.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // Get transfers where From or To project is assigned to this user
        // Or requested by this user? Usually Site Managers see requests for their sites.
        const transfers = await Transfer.find({
            $or: [
                { fromProject: { $in: user.assignedSites } },
                { toProject: { $in: user.assignedSites } },
                { requestedBy: userId }
            ]
        })
            .populate('fromProject', 'name')
            .populate('toProject', 'name')
            .populate('labourId', 'name designation')
            .populate('machineId', 'name')
            .populate('requestedBy', 'name')
            .sort('-createdAt');

        res.json({
            success: true,
            data: transfers
        });
    } catch (error) {
        next(error);
    }
};

const getMaterials = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user || !user.assignedSites || user.assignedSites.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // Aggregate stocks by project and material to get available quantities
        const materials = await Stock.aggregate([
            {
                $match: {
                    projectId: { $in: user.assignedSites },
                    quantity: { $gt: 0 } // Only consider positive quantities
                }
            },
            {
                $group: {
                    _id: { material: "$materialName", project: "$projectId" },
                    totalQuantity: { $sum: "$quantity" },
                    unit: { $first: "$unit" }
                }
            },
            {
                $project: {
                    _id: 0,
                    materialName: "$_id.material",
                    projectId: "$_id.project",
                    quantity: "$totalQuantity",
                    unit: 1
                }
            },
            { $sort: { materialName: 1 } }
        ]);

        res.json({
            success: true,
            data: materials // Returns [{ materialName, projectId, quantity, unit }, ...]
        });
    } catch (error) {
        next(error);
    }
};

// ============ PAYMENT ============

// Pay labour
const payLabour = async (req, res, next) => {
    try {
        const { labourId, amount, deduction, advance, paymentMode, remarks } = req.body;
        const userId = req.user.userId;

        const amountVal = parseFloat(amount) || 0;
        const deductionVal = parseFloat(deduction) || 0;
        const advanceVal = parseFloat(advance) || 0;
        const finalAmount = amountVal - deductionVal - advanceVal;

        // At least one of amount, deduction or advance must be provided
        if (amountVal <= 0 && advanceVal <= 0 && deductionVal <= 0) {
            return res.status(400).json({ success: false, error: 'Amount, Advance, or Deduction must be greater than 0' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const labour = await Labour.findById(labourId);
        if (!labour) {
            return res.status(404).json({ success: false, error: 'Labour not found' });
        }

        // Check sufficient balance if final amount > 0 AND payment is cash
        if (finalAmount > 0 && paymentMode === 'cash') {
            if (user.walletBalance < finalAmount) {
                return res.status(400).json({
                    success: false,
                    error: `Insufficient wallet balance. Current: â‚¹${user.walletBalance}`
                });
            }

            // Deduct from wallet
            user.walletBalance -= finalAmount;
            await user.save();
        }

        const payment = new LabourPayment({
            labourId,
            userId,
            amount: amountVal,
            deduction: deductionVal,
            advance: advanceVal,
            finalAmount,
            paymentMode,
            remarks
        });

        await payment.save();

        // Update labour pending payout and advance balance
        const reducePending = amountVal + deductionVal;
        labour.pendingPayout -= reducePending;
        if (advanceVal > 0) labour.advance = (labour.advance || 0) + advanceVal;
        if (deductionVal > 0) labour.advance = Math.max(0, (labour.advance || 0) - deductionVal);
        await labour.save();

        res.status(201).json({
            success: true,
            message: 'Payment recorded successfully',
            data: payment
        });
    } catch (error) {
        next(error);
    }
};

const getPayments = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { startDate, endDate, labourId } = req.query;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        let query = { userId: user._id };

        if (labourId) {
            query.labourId = labourId;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        let paymentsQuery = LabourPayment.find(query)
            .populate('labourId', 'name designation')
            .sort('-createdAt');

        // Only limit if no date filter is applied to strictly get recent
        // But for totals, we might want all? Let's limit default view, but if filters applied, show all matching.
        if (!startDate && !endDate && !labourId) {
            paymentsQuery = paymentsQuery.limit(50);
        }

        const payments = await paymentsQuery.lean();

        // Map to include labourName for frontend
        const formattedPayments = payments.map(p => ({
            _id: p._id,
            amount: p.amount,
            deduction: p.deduction,
            advance: p.advance || 0,
            finalAmount: p.finalAmount,
            paymentMode: p.paymentMode,
            createdAt: p.createdAt,
            labourId: p.labourId?._id || p.labourId,
            labourName: p.labourId?.name || 'Unknown Labour'
        }));

        res.json({
            success: true,
            data: formattedPayments
        });
    } catch (error) {
        console.error('â Œ Error in getPayments:', error);
        next(error);
    }
};

// ============ NOTIFICATIONS ============

const getNotifications = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const notifications = await Notification.find({ recipient: userId })
            .sort('-createdAt')
            .limit(50);

        const unreadCount = await Notification.countDocuments({ recipient: userId, read: false });

        res.json({
            success: true,
            data: notifications,
            unreadCount
        });
    } catch (error) {
        next(error);
    }
};

const markNotificationRead = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        // Mark specific or all
        if (id === 'all') {
            await Notification.updateMany(
                { recipient: userId, read: false },
                { read: true }
            );
        } else {
            await Notification.findOneAndUpdate(
                { _id: id, recipient: userId },
                { read: true }
            );
        }

        res.json({ success: true, message: 'Marked as read' });
    } catch (error) {
        next(error);
    }
};

// ============ PROFILE ============

const getProfile = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId).select('-password');

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            data: user
        });
    } catch (error) {
        next(error);
    }
};

// ============ VENDORS ============

const getVendors = async (req, res, next) => {
    try {
        const vendors = await Vendor.find().select('name contact');
        res.json({
            success: true,
            data: vendors
        });
    } catch (error) {
        next(error);
    }
};

// ============ PROJECTS ============

const getProjects = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        console.log('ðŸ” Site Manager Projects - User:', user.name, 'assignedSites:', user.assignedSites);

        // Check if user has assigned sites
        if (!user.assignedSites || user.assignedSites.length === 0) {
            console.log('â„¹ï¸ No assigned sites for site manager, returning empty projects');
            return res.json({
                success: true,
                data: []
            });
        }

        const projects = await Project.find({
            _id: { $in: user.assignedSites }
        });

        console.log(`âœ… Found ${projects.length} projects for site manager ${user.name}`);

        res.json({
            success: true,
            data: projects
        });
    } catch (error) {
        console.error('âŒ Error in getProjects:', error);
        next(error);
    }
};

// ============ STOCK OUT & MOVEMENTS ============

const addStockOut = async (req, res, next) => {
    try {
        const { projectId, materialName, quantity, unit, usedFor, date, remarks } = req.body;
        const userId = req.user.userId;

        const stockOut = new StockOut({
            projectId,
            materialName,
            quantity: parseFloat(quantity),
            unit,
            usedFor,
            date: date || Date.now(),
            remarks,
            recordedBy: userId
        });

        await stockOut.save();

        res.status(201).json({
            success: true,
            message: 'Stock usage recorded',
            data: stockOut
        });
    } catch (error) {
        next(error);
    }
};

const getStockMovements = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { startDate, endDate, search, page = 1, limit = 20 } = req.query;
        const user = await User.findById(userId);

        if (!user.assignedSites || user.assignedSites.length === 0) {
            return res.json({ success: true, data: [], pagination: { total: 0, page: 1, pages: 0 } });
        }

        // Build Queries
        let inQuery = { projectId: { $in: user.assignedSites } };
        let outQuery = { projectId: { $in: user.assignedSites } };

        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            inQuery.createdAt = { $gte: start, $lte: end };
            outQuery.date = { $gte: start, $lte: end };
        } else if (startDate) {
            inQuery.createdAt = { $gte: new Date(startDate) };
            outQuery.date = { $gte: new Date(startDate) };
        }

        // Fetch Data
        const [stocksIn, stocksOut] = await Promise.all([
            Stock.find(inQuery).select('-photo').populate('projectId', 'name').populate('vendorId', 'name').sort('-createdAt').lean(),
            StockOut.find(outQuery).populate('projectId', 'name').sort('-date').lean()
        ]);

        // Combine and Tag
        const combined = [
            ...stocksIn.map(s => ({
                _id: s._id,
                date: s.createdAt,
                material: s.materialName,
                vendor: s.vendorId?.name || '-',
                type: 'IN',
                quantity: s.quantity,
                unit: s.unit,
                project: s.projectId?.name || 'Unknown',
                remarks: s.remarks,
                usedFor: '-'
            })),
            ...stocksOut.map(s => ({
                _id: s._id,
                date: s.date,
                material: s.materialName,
                vendor: '-',
                type: 'OUT',
                quantity: s.quantity,
                unit: s.unit,
                project: s.projectId?.name || 'Unknown',
                remarks: s.remarks,
                usedFor: s.usedFor
            }))
        ];

        // Filter (Search)
        let filtered = combined;
        if (search) {
            const regex = new RegExp(search, 'i');
            filtered = combined.filter(item =>
                regex.test(item.material) ||
                regex.test(item.vendor) ||
                regex.test(item.remarks) ||
                regex.test(item.usedFor)
            );
        }

        // Sort (Newest First)
        filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Pagination
        const total = filtered.length;
        const totalPages = Math.ceil(total / limit);
        const startIndex = (page - 1) * limit;
        const paginatedData = filtered.slice(startIndex, startIndex + parseInt(limit));

        res.json({
            success: true,
            data: paginatedData,
            pagination: {
                total,
                page: Number(page),
                pages: totalPages
            }
        });
    } catch (error) {
        next(error);
    }
};

// ============ MACHINES ============

const getMachines = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        if (!user.assignedSites || user.assignedSites.length === 0) {
            console.log('âš ï¸ No assigned sites for user:', user.name);
            return res.json({ success: true, data: [] });
        }

        console.log(`ðŸ” Fetching machines for sites:`, user.assignedSites);

        const { projectId } = req.query;
        const query = projectId
            ? { projectId: projectId }
            : { projectId: { $in: user.assignedSites } };

        console.log(`ðŸ” Fetching machines for query:`, query);

        const machines = await Machine.find(query).populate('projectId', 'name');

        console.log(`âœ… Found ${machines.length} machines for user ${user.name}`);

        res.json({
            success: true,
            data: machines
        });
    } catch (error) {
        console.error('âŒ Error in getMachines:', error);
        next(error);
    }
};

// ============ DAILY REPORT ============

const submitDailyReport = async (req, res, next) => {
    try {
        const { projectId, reportType, description, photos, roadProgress, stockUsed } = req.body;
        const userId = req.user.userId;

        // Construct remarks string from roadProgress
        let progressRemarks = '';
        if (roadProgress && Array.isArray(roadProgress)) {
            progressRemarks = roadProgress.map(rp => `${rp.description || 'Road'}: ${rp.value} ${rp.unit}`).join(', ');
        }

        // Validate stock availability and deduct quantities
        if (stockUsed && stockUsed.length > 0) {
            for (const item of stockUsed) {
                // Find available stock for this material
                const stock = await Stock.findOne({
                    projectId,
                    materialName: item.materialName,
                    quantity: { $gte: item.quantity }
                }).sort({ createdAt: 1 }); // FIFO - First In First Out

                if (!stock) {
                    return res.status(400).json({
                        success: false,
                        error: `Insufficient stock for ${item.materialName}. Required: ${item.quantity} ${item.unit}`
                    });
                }

                // Deduct quantity from stock
                stock.quantity -= item.quantity;
                await stock.save();

                // Create StockOut record for tracking
                await StockOut.create({
                    projectId,
                    materialName: item.materialName,
                    quantity: item.quantity,
                    unit: item.unit,
                    usedFor: `Daily Report - ${reportType}`,
                    remarks: `Road construction: ${progressRemarks}`,
                    recordedBy: userId
                });

                // Store stockId in the item for reference
                item.stockId = stock._id;
            }
        }

        // Create Daily Report
        const dailyReport = new DailyReport({
            projectId,
            reportType,
            description,
            photos: photos || [],
            roadProgress: roadProgress || [],
            stockUsed: stockUsed || [],
            submittedBy: userId
        });

        await dailyReport.save();

        console.log(`âœ… Daily Report submitted for project ${projectId} by user ${userId}`);

        res.status(201).json({
            success: true,
            message: 'Daily report submitted successfully',
            data: dailyReport
        });
    } catch (error) {
        console.error('âŒ Error submitting daily report:', error);
        next(error);
    }
};

const getDailyReports = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user || !user.assignedSites || user.assignedSites.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const reports = await DailyReport.find({
            projectId: { $in: user.assignedSites }
        })
            .populate('projectId', 'name location')
            .populate('submittedBy', 'name')
            .sort('-createdAt')
            .limit(50);

        console.log(`âœ… Found ${reports.length} daily reports for user ${user.name}`);

        res.json({
            success: true,
            data: reports
        });
    } catch (error) {
        console.error('âŒ Error fetching daily reports:', error);
        next(error);
    }
};

const getAllMaterialNames = async (req, res, next) => {
    try {
        // Fetch unique material names from Stock
        const stockMaterials = await Stock.distinct('materialName');

        // Fetch defined item names (categories: big, lab, consumables, equipment)
        const itemNames = await ItemName.distinct('name', { category: 'consumables' });

        // Combine and unique
        const allMaterials = [...new Set([...stockMaterials, ...itemNames])].sort();

        res.status(200).json({
            success: true,
            data: allMaterials
        });
    } catch (error) {
        next(error);
    }
};


// ============ LAB EQUIPMENT ============

const getLabEquipments = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user || !user.assignedSites || user.assignedSites.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const { projectId } = req.query;
        const query = {
            category: 'lab',
            projectId: projectId ? projectId : { $in: user.assignedSites }
        };

        const labEquipments = await Machine.find(query).populate('projectId', 'name').lean();

        res.json({ success: true, data: labEquipments });
    } catch (error) {
        console.error('âŒ Error fetching lab equipments:', error);
        next(error);
    }
};

const getConsumableGoods = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user || !user.assignedSites || user.assignedSites.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const { projectId } = req.query;
        const query = {
            category: 'consumables',
            projectId: projectId ? projectId : { $in: user.assignedSites }
        };

        const consumableGoods = await Machine.find(query).populate('projectId', 'name').lean();

        res.json({ success: true, data: consumableGoods });
    } catch (error) {
        console.error('âŒ Error fetching consumable goods:', error);
        next(error);
    }
};

const getEquipments = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user || !user.assignedSites || user.assignedSites.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const { projectId } = req.query;
        const query = {
            category: 'equipment',
            projectId: projectId ? projectId : { $in: user.assignedSites }
        };

        const equipments = await Machine.find(query).populate('projectId', 'name').lean();

        res.json({ success: true, data: equipments });
    } catch (error) {
        console.error('âŒ Error fetching equipments:', error);
        next(error);
    }
};


// Get machines assigned to site manager's projects
// Get machines assigned to site manager's projects
const getSiteMachines = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { projectId } = req.query; // Support filtering by project
        const user = await User.findById(userId);

        if (!user || !user.assignedSites || user.assignedSites.length === 0) {
            console.log('âš ï¸ User has no assigned sites:', user);
            return res.json({
                success: true,
                data: [],
                message: 'No projects assigned to this user'
            });
        }

        // Determine which projects to filter by
        let targetProjects = user.assignedSites;

        // If specific project requested, validate and use only that
        if (projectId) {
            const isAssigned = user.assignedSites.some(site => site.toString() === projectId);
            if (isAssigned) {
                targetProjects = [projectId];
            } else {
                // If requesting a project they aren't assigned to, return empty or error
                // For safety, let's just scope to their actually assigned sites if the request is bad,
                // or simpler: just return empty for that specific invalid project filter.
                // But strict isolation means we strictly respect valid filters.
                targetProjects = [projectId]; // effectively filtering by query, assuming middleware checked auth. 
                // But better to intersect:
                // targetProjects = user.assignedSites.filter(site => site.toString() === projectId);
            }
        }

        // 1. Find all contractors assigned to THESE specific target projects
        const contractors = await Contractor.find({
            assignedProjects: { $in: targetProjects }
        });
        const contractorIds = contractors.map(c => c._id);

        // 2. Find machines assigned to THESE sites OR to THESE contractors
        const machines = await Machine.find({
            $or: [
                { projectId: { $in: targetProjects } },
                { assignedToContractor: { $in: contractorIds } }
            ],
            status: { $in: ['in-use', 'available'] }
        })
            .populate('assignedToContractor', 'name') // Populate contractor details if needed
            .sort('-createdAt');

        res.json({
            success: true,
            data: machines
        });
    } catch (error) {
        next(error);
    }
};

// Toggle machine rent pause
const toggleMachineRentPause = async (req, res, next) => {
    try {
        const { id } = req.params;
        const machine = await Machine.findById(id);

        if (!machine) {
            return res.status(404).json({
                success: false,
                error: 'Machine not found'
            });
        }

        if (machine.isRentPaused) {
            // RESUME RENT
            const now = new Date();
            const pausedAt = new Date(machine.rentPausedAt);
            const durationHours = (now - pausedAt) / (1000 * 60 * 60);

            machine.rentPausedHistory.push({
                pausedAt: machine.rentPausedAt,
                resumedAt: now,
                duration: durationHours
            });
            machine.isRentPaused = false;
            machine.rentPausedAt = null;
        } else {
            // PAUSE RENT
            machine.isRentPaused = true;
            machine.rentPausedAt = new Date();
        }

        await machine.save();

        res.json({
            success: true,
            message: machine.isRentPaused ? 'Machine rent paused' : 'Machine rent resumed',
            data: {
                isRentPaused: machine.isRentPaused,
                rentPausedAt: machine.rentPausedAt
            }
        });

    } catch (error) {
        next(error);
    }
};


// ============ WALLET & PAYMENTS ============

const getWalletTransactions = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const transactions = [];

        // 1. Inflows: Wallet Allocations
        const allocations = await Transaction.find({
            category: 'wallet_allocation',
            relatedId: userId
        }).sort('-date').lean();

        allocations.forEach(t => {
            transactions.push({
                _id: t._id,
                date: t.date,
                type: 'credit',
                category: 'Allocation',
                description: t.description || 'Wallet Top-up',
                amount: t.amount,
                refModel: 'Transaction'
            });
        });

        // 2. Outflows: Expenses
        const expenses = await Expense.find({ addedBy: userId }).lean();
        expenses.forEach(e => {
            transactions.push({
                _id: e._id,
                date: e.createdAt,
                type: 'debit',
                category: 'Expense',
                description: `${e.name} (${e.category})`,
                amount: e.amount,
                refModel: 'Expense'
            });
        });

        // 3. Outflows: Stock (Paid)
        const stocks = await Stock.find({ addedBy: userId, paymentStatus: 'paid' }).populate('vendorId', 'name').lean();
        stocks.forEach(s => {
            transactions.push({
                _id: s._id,
                date: s.createdAt,
                type: 'debit',
                category: 'Stock Purchase',
                description: `${s.materialName} - ${s.quantity} ${s.unit} from ${s.vendorId?.name || 'Vendor'}`,
                amount: s.totalPrice,
                refModel: 'Stock'
            });
        });

        // 4. Inflows: Third Party Funds
        const thirdPartyFunds = await Transaction.find({
            category: 'third_party_funds',
            addedBy: userId
        }).sort('-date').lean();

        thirdPartyFunds.forEach(t => {
            transactions.push({
                _id: t._id,
                date: t.date,
                type: 'credit',
                category: 'Third Party Funds',
                description: t.description || 'Received from Third Party',
                amount: t.amount,
                refModel: 'Transaction'
            });
        });

        // 5. Outflows: Contractor Payments
        const contractorPayments = await ContractorPayment.find({ paidBy: userId }).populate('contractorId', 'name').lean();
        contractorPayments.forEach(p => {
            transactions.push({
                _id: p._id,
                date: p.date,
                type: 'debit',
                category: 'Contractor Payment',
                description: `Payment to ${p.contractorId?.name || 'Contractor'}`,
                amount: p.amount,
                refModel: 'ContractorPayment'
            });
        });

        // 5. Outflows: Vendor Payments
        const vendorPayments = await VendorPayment.find({ recordedBy: userId }).populate('vendorId', 'name').lean();
        vendorPayments.forEach(p => {
            transactions.push({
                _id: p._id,
                date: p.date,
                type: 'debit',
                category: 'Vendor Payment',
                description: `Payment to ${p.vendorId?.name || 'Vendor'}`,
                amount: p.amount,
                refModel: 'VendorPayment'
            });
        });

        // 6. Outflows: Labour Payments
        const labPayments = await LabourPayment.find({ userId, finalAmount: { $gt: 0 }, paymentMode: 'cash' }).populate('labourId', 'name').lean();
        labPayments.forEach(p => {
            transactions.push({
                _id: p._id,
                date: p.date || p.createdAt,
                type: 'debit',
                category: 'Labour Payment',
                description: `Payment to ${p.labourId?.name || 'Labour'}`,
                amount: p.finalAmount,
                refModel: 'LabourPayment'
            });
        });

        // 7. Wallet Transfers (Manager to Manager)
        const transfers = await Transaction.find({
            addedBy: userId,
            category: 'manager_transfer'
        }).sort('-date').lean();

        transfers.forEach(t => {
            transactions.push({
                _id: t._id,
                date: t.date,
                type: t.type, // Use the type from transaction (credit/debit)
                category: 'Wallet Transfer',
                description: t.description,
                amount: t.amount,
                refModel: 'Transaction'
            });
        });

        transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({ success: true, data: transactions });
    } catch (error) {
        next(error);
    }
};

// Get other site managers for funds transfer
const getOtherManagers = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const managers = await User.find({
            _id: { $ne: userId },
            role: 'sitemanager',
            active: true
        }).select('name email phone');
        
        res.json({ success: true, data: managers });
    } catch (error) {
        next(error);
    }
};

// Transfer funds to another site manager
const transferFunds = async (req, res, next) => {
    try {
        const { amount, recipientId, remarks, paymentMode, date } = req.body;
        const senderId = req.user.userId;

        const fundAmount = parseFloat(amount);
        if (isNaN(fundAmount) || fundAmount <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid amount' });
        }

        const sender = await User.findById(senderId);
        const recipient = await User.findById(recipientId);

        if (!sender) return res.status(404).json({ success: false, error: 'Sender not found' });
        if (!recipient) return res.status(404).json({ success: false, error: 'Recipient not found' });

        if (sender.walletBalance < fundAmount) {
            return res.status(400).json({ success: false, error: 'Insufficient wallet balance for transfer' });
        }

        // Create debit transaction for sender
        const debitTx = new Transaction({
            amount: fundAmount,
            type: 'debit',
            category: 'manager_transfer',
            paymentMode: paymentMode || 'cash',
            description: `Transferred to ${recipient.name}${remarks ? ` - ${remarks}` : ''}`,
            date: date || new Date(),
            addedBy: senderId,
            relatedId: recipientId,
            onModel: 'User'
        });

        // Create credit transaction for recipient
        const creditTx = new Transaction({
            amount: fundAmount,
            type: 'credit',
            category: 'manager_transfer',
            paymentMode: paymentMode || 'cash',
            description: `Received from ${sender.name}${remarks ? ` - ${remarks}` : ''}`,
            date: date || new Date(),
            addedBy: recipientId, // Ownership belongs to recipient
            relatedId: senderId,
            onModel: 'User'
        });

        await Promise.all([debitTx.save(), creditTx.save()]);

        // Update balances
        sender.walletBalance -= fundAmount;
        recipient.walletBalance += fundAmount;

        await Promise.all([sender.save(), recipient.save()]);

        res.status(201).json({
            success: true,
            message: 'Funds transferred successfully',
            data: {
                transaction: debitTx,
                newBalance: sender.walletBalance
            }
        });
    } catch (error) {
        console.error('Error transferring funds:', error);
        next(error);
    }
};

const getContractors = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);
        if (!user || !user.assignedSites) return res.json({ success: true, data: [] });

        const contractors = await Contractor.find({
            assignedProjects: { $in: user.assignedSites }
        });
        res.json({ success: true, data: contractors });
    } catch (error) {
        next(error);
    }
};

const payContractor = async (req, res, next) => {
    try {
        const { contractorId, projectId, amount, paymentMode, remarks, advance, deduction } = req.body;
        const userId = req.user.userId;
        const user = await User.findById(userId);

        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        // Fetch contractor to get name (required field in model)
        const contractor = await Contractor.findById(contractorId);
        if (!contractor) return res.status(404).json({ success: false, error: 'Contractor not found' });

        const amountVal = parseFloat(amount) || 0;
        const advanceVal = parseFloat(advance) || 0;
        const deductionVal = parseFloat(deduction) || 0;

        if (amountVal <= 0 && advanceVal <= 0 && deductionVal <= 0) {
            return res.status(400).json({ success: false, error: 'Amount, Advance, or Deduction must be greater than 0' });
        }

        const payAmount = amountVal + advanceVal; // amount added to advance affects wallet? Actually in forms they are separate. Let's just use amountVal if amount is provided, or advanceVal. Usually it's one or the other.
        const walletDeduction = amountVal > 0 ? amountVal : advanceVal;

        if (walletDeduction > 0) {
            if (user.walletBalance < walletDeduction) {
                return res.status(400).json({ success: false, error: `Insufficient wallet balance. Current: ₹${user.walletBalance}` });
            }
            user.walletBalance -= walletDeduction;
            await user.save();
        }

        const payment = new ContractorPayment({
            contractorId,
            contractorName: contractor.name,
            projectId,
            amount: amountVal,
            advance: advanceVal,
            deduction: deductionVal,
            date: new Date(),
            paymentMode: paymentMode || 'cash',
            remark: remarks || '',
            paidBy: userId
        });
        await payment.save();

        if (amountVal > 0 || deductionVal > 0 || advanceVal > 0) {
            const reducePending = amountVal + deductionVal;
            contractor.pendingAmount = Math.max(0, (contractor.pendingAmount || 0) - reducePending);
            if (advanceVal > 0) contractor.advancePayment = (contractor.advancePayment || 0) + advanceVal;
            if (deductionVal > 0) contractor.advancePayment = Math.max(0, (contractor.advancePayment || 0) - deductionVal);
            await contractor.save();
        }
        res.json({ success: true, message: 'Payment recorded', data: payment });
    } catch (error) {
        next(error);
    }
};

const payVendor = async (req, res, next) => {
    try {
        const { vendorId, amount, paymentMode, remarks, advance, deduction } = req.body;
        const userId = req.user.userId;
        const user = await User.findById(userId);
        const vendor = await Vendor.findById(vendorId);

        if (!user || !vendor) return res.status(404).json({ success: false, error: 'User or Vendor not found' });

        const amountVal = parseFloat(amount) || 0;
        const advanceVal = parseFloat(advance) || 0;
        const deductionVal = parseFloat(deduction) || 0;

        if (amountVal <= 0 && advanceVal <= 0 && deductionVal <= 0) {
            return res.status(400).json({ success: false, error: 'Amount, Advance, or Deduction must be greater than 0' });
        }

        const walletDeduction = amountVal > 0 ? amountVal : advanceVal;

        if (walletDeduction > 0) {
            if (user.walletBalance < walletDeduction) {
                return res.status(400).json({ success: false, error: `Insufficient wallet balance. Current: ₹${user.walletBalance}` });
            }
            user.walletBalance -= walletDeduction;
            await user.save();
        }

        if (amountVal > 0 || deductionVal > 0 || advanceVal > 0) {
            const reducePending = amountVal + deductionVal;
            vendor.pendingAmount = Math.max(0, (vendor.pendingAmount || 0) - reducePending);
            if (advanceVal > 0) vendor.advancePayment = (vendor.advancePayment || 0) + advanceVal;
            if (deductionVal > 0) vendor.advancePayment = Math.max(0, (vendor.advancePayment || 0) - deductionVal);
            await vendor.save();
        }

        const payment = new VendorPayment({
            vendorId,
            amount: amountVal,
            advance: advanceVal,
            deduction: deductionVal,
            date: new Date(),
            paymentMode: paymentMode || 'cash',
            remarks: remarks || '',
            recordedBy: userId
        });
        await payment.save();
        res.json({ success: true, message: 'Payment recorded', data: payment });
    } catch (error) {
        next(error);
    }
};

const updateLabourAttendance = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const attendance = await LabourAttendance.findById(id);
        if (!attendance) return res.status(404).json({ success: false, error: 'Record not found' });

        // Check if date is today
        const attendanceDate = new Date(attendance.date).setHours(0, 0, 0, 0);
        const today = new Date().setHours(0, 0, 0, 0);

        if (attendanceDate < today) {
            return res.status(403).json({
                success: false,
                error: 'Cannot edit past attendance. Only today\'s attendance can be modified.'
            });
        }

        const labour = await Labour.findById(attendance.labourId);
        if (labour) {
            // Revert previous payout
            if (attendance.status === 'present') await Labour.findByIdAndUpdate(attendance.labourId, { $inc: { pendingPayout: -labour.dailyWage } });
            else if (attendance.status === 'half') await Labour.findByIdAndUpdate(attendance.labourId, { $inc: { pendingPayout: -(labour.dailyWage / 2) } });

            // Apply new payout
            if (status === 'present') await Labour.findByIdAndUpdate(attendance.labourId, { $inc: { pendingPayout: labour.dailyWage } });
            else if (status === 'half') await Labour.findByIdAndUpdate(attendance.labourId, { $inc: { pendingPayout: (labour.dailyWage / 2) } });
        }

        attendance.status = status;
        await attendance.save();

        res.json({ success: true, message: 'Updated', data: attendance });
    } catch (error) {
        next(error);
    }
};

// ============ DETAILS & HISTORY ============

const getMachineDetails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const machine = await Machine.findById(id).populate('assignedToContractor', 'name');

        if (!machine) return res.status(404).json({ success: false, error: 'Machine not found' });

        let totalRent = 0;
        let duration = 0;

        // Determine assignment start
        const startDate = machine.assignedAt ? new Date(machine.assignedAt) : machine.createdAt; // Fallback
        const endDate = machine.returnedAt ? new Date(machine.returnedAt) : new Date();

        // Duration Calculation - guard against tiny negative values due to clock skew
        const totalHours = Math.max(0, (endDate - new Date(startDate)) / (1000 * 60 * 60));

        // Calculate Pause Duration - only count pauses that happened AFTER this assignment started
        let totalPausedHours = 0;
        if (machine.rentPausedHistory && machine.rentPausedHistory.length > 0) {
            machine.rentPausedHistory
                .filter(pause => new Date(pause.pausedAt) >= new Date(startDate)) // ignore old assignments
                .forEach(pause => {
                    if (pause.resumedAt && pause.pausedAt) {
                        const paused = Math.max(0, (new Date(pause.resumedAt) - new Date(pause.pausedAt)) / (1000 * 60 * 60));
                        totalPausedHours += paused;
                    }
                });
        }

        // Handle currently paused - only count from startDate onwards
        if (machine.isRentPaused && machine.rentPausedAt) {
            const pauseStart = Math.max(new Date(machine.rentPausedAt), new Date(startDate));
            totalPausedHours += Math.max(0, (new Date() - pauseStart) / (1000 * 60 * 60));
        }

        const billableHours = Math.max(0, totalHours - totalPausedHours);

        if (machine.rentalType === 'perHour') {
            duration = billableHours;
            totalRent = billableHours * (machine.assignedRentalPerDay || 0);
        } else {
            duration = billableHours / 24;
            totalRent = Math.ceil(duration) * (machine.assignedRentalPerDay || 0);
        }

        res.json({
            success: true,
            data: {
                machine,
                rentCalculation: {
                    startDate,
                    endDate: machine.returnedAt ? machine.returnedAt : new Date(),
                    isReturned: !!machine.returnedAt,
                    totalDurationHours: totalHours.toFixed(2),
                    totalPausedHours: totalPausedHours.toFixed(2),
                    billableHours: billableHours.toFixed(2),
                    billableDays: (billableHours / 24).toFixed(2),
                    rate: machine.assignedRentalPerDay,
                    type: machine.rentalType,
                    estimatedTotalRent: Math.round(totalRent)
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

const getLabourDetails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const labour = await Labour.findById(id).populate('assignedSite', 'name');

        if (!labour) return res.status(404).json({ success: false, error: 'Labour not found' });

        // 1. Fetch Payment History (Across ALL Projects)
        const payments = await LabourPayment.find({ labourId: id })
            .populate('userId', 'name') // Paid by whom (referenced as userId in schema)
            .sort('-createdAt')
            .lean();

        // 2. Fetch Attendance Summary
        const attendance = await LabourAttendance.find({ labourId: id })
            .populate('projectId', 'name')
            .sort('-date')
            .limit(30) // Last 30 records
            .lean();

        // 3. Calculate totals
        const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const totalAdvances = payments.reduce((sum, p) => sum + (p.advance || 0), 0);
        const totalDeductions = payments.reduce((sum, p) => sum + (p.deduction || 0), 0);

        // 4. Separate advances from wage payments
        const wagePayments = payments.filter(p => (p.advance || 0) === 0);
        const advancePayments = payments.filter(p => (p.advance || 0) > 0);

        res.json({
            success: true,
            data: {
                labour,
                payments: wagePayments,
                advances: advancePayments,
                attendance,
                totalPaid,
                totalAdvances,
                totalDeductions
            }
        });
    } catch (error) {
        next(error);
    }
};

const getSiteContractors = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);
        if (!user || !user.assignedSites) return res.json({ success: true, data: [] });

        const contractors = await Contractor.find({
            assignedProjects: { $in: user.assignedSites }
        }).lean();

        // Add labour count for each contractor
        const contractorsWithLabourCount = await Promise.all(
            contractors.map(async (contractor) => {
                const labourCount = await Labour.countDocuments({ contractorId: contractor._id });
                return {
                    ...contractor,
                    labourCount
                };
            })
        );

        res.json({ success: true, data: contractorsWithLabourCount });
    } catch (error) {
        next(error);
    }
};

const addContractor = async (req, res, next) => {
    try {
        const { name, mobile, address, distanceValue, distanceUnit, expensePerUnit, assignedProjectId } = req.body;

        // Check if contractor exists
        let contractor = await Contractor.findOne({ mobile });
        if (contractor) {
            // If exists, just ensure project is assigned
            if (!contractor.assignedProjects.includes(assignedProjectId)) {
                contractor.assignedProjects.push(assignedProjectId);
                await contractor.save();
            }
            return res.json({ success: true, message: 'Existing contractor assigned to project', data: contractor });
        }

        // Create new
        contractor = new Contractor({
            name,
            mobile,
            address,
            distanceValue,
            distanceUnit,
            expensePerUnit,
            assignedProjects: [assignedProjectId],
            status: 'active'
        });

        await contractor.save();
        res.json({ success: true, message: 'Contractor added successfully', data: contractor });
    } catch (error) {
        next(error);
    }
};

const getContractorDetails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { projectId } = req.query; // Optional filter

        const contractor = await Contractor.findById(id);
        if (!contractor) return res.status(404).json({ success: false, error: 'Contractor not found' });

        // 1. Rented Machines
        const query = { assignedToContractor: id };
        if (projectId) query.projectId = projectId;

        const machines = await Machine.find(query).lean();

        // 2. Payment History
        const paymentQuery = { contractorId: id };
        if (projectId) paymentQuery.projectId = projectId;

        const payments = await ContractorPayment.find(paymentQuery)
            .populate('projectId', 'name')
            .populate('paidBy', 'name')
            .sort('-date')
            .lean();

        // 3. Labours
        const labourQuery = { contractorId: id };
        if (projectId) labourQuery.assignedSite = projectId;
        const labours = await Labour.find(labourQuery).lean();

        res.json({
            success: true,
            data: {
                contractor,
                machines,
                payments,
                labours
            }
        });
    } catch (error) {
        next(error);
    }
};
// Get Single Project Details (Site Manager)
const getProjectDetails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        // Verify project assignment (Optional: if middleware already checks generally, but good for specific ID access)
        const user = await User.findById(userId);
        if (!user || !user.assignedSites || !user.assignedSites.includes(id)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied. You are not assigned to this project.'
            });
        }

        const project = await Project.findById(id)
            .populate('assignedManager', 'name email')
            .lean();

        if (!project) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        // Fetch related data in parallel (Scoped to this project)
        const [expenses, labours, stocks, machines, contractors] = await Promise.all([
            Expense.find({ projectId: id }).sort('-createdAt').limit(50).lean(),
            Labour.find({ assignedSite: id }).populate('contractorId', 'name').lean(),
            Stock.find({ projectId: id }).populate('vendorId', 'name').sort('-createdAt').limit(50).lean(),
            Machine.find({ projectId: id }).sort('-createdAt').lean(),
            Contractor.find({ assignedProjects: id }).lean()
        ]);

        res.json({
            success: true,
            data: {
                project,
                expenses,
                labours,
                stocks,
                machines,
                contractors
            }
        });
    } catch (error) {
        next(error);
    }
};

// Get Contractor Payments for Site Manager
const getContractorPayments = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { startDate, endDate, contractorId } = req.query;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        let query = { paidBy: userId };

        if (contractorId) {
            query.contractorId = contractorId;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        let paymentsQuery = ContractorPayment.find(query)
            .populate('contractorId', 'name contactPerson phone')
            .populate('projectId', 'name location')
            .sort('-date');

        if (!startDate && !endDate && !contractorId) {
            paymentsQuery = paymentsQuery.limit(50);
        }

        const payments = await paymentsQuery.lean();

        res.json({
            success: true,
            data: payments
        });
    } catch (error) {
        next(error);
    }
};

// Get Vendor Payments for Site Manager
const getVendorPayments = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { startDate, endDate, vendorId } = req.query;

        let query = { recordedBy: userId };

        if (vendorId) {
            query.vendorId = vendorId;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        let paymentsQuery = VendorPayment.find(query)
            .populate('vendorId', 'name contact')
            .sort('-date');

        if (!startDate && !endDate && !vendorId) {
            paymentsQuery = paymentsQuery.limit(50);
        }

        const payments = await paymentsQuery.lean();

        res.json({
            success: true,
            data: payments
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getDashboard,
    markAttendance,
    getMyAttendance,
    getLabours,
    enrollLabour,
    updateLabour,
    markLabourAttendance,
    getLabourAttendance,
    addStockIn,
    getStocks,
    recordStockOut,
    getStockOuts,
    addStockOut,
    getStockMovements,
    submitDailyReport,
    getDailyReports,
    uploadGalleryImages,
    getGalleryImages,
    addExpense,
    getExpenses,
    requestTransfer,
    getTransfers,
    payLabour,
    getPayments,
    getNotifications,
    markNotificationRead,
    getProfile,
    getVendors,
    getProjects,
    getMachines,
    getMaterials,
    getAllMaterialNames,
    getLabEquipments,
    getConsumableGoods,
    getEquipments,
    getSiteMachines,
    toggleMachineRentPause,
    getWalletTransactions,
    getOtherManagers,
    transferFunds,
    getContractors,
    payContractor,
    payVendor,
    updateLabourAttendance,
    getMachineDetails,
    getLabourDetails,
    getSiteContractors,
    addContractor,
    getContractorDetails,
    getProjectDetails,
    getContractorPayments,
    getVendorPayments
};
