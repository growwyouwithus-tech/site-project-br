/**
 * Admin Controller - MongoDB Version
 * Handles all admin-specific operations with MongoDB
 */

const mongoose = require('mongoose');
const { User, Project, Vendor, VendorPayment, Expense, Labour, Contractor, ContractorPayment, LabourPayment, Machine, Stock, LabEquipment, ConsumableGoods, Equipment, Transaction, Transfer, BankDetail, Creditor, CreditorPayment, Attendance, LabourAttendance, ItemName, Notification, DailyReport, StockOut } = require('../models');

// ============ DASHBOARD ============

// Get dashboard summary
// Get dashboard summary
const getDashboard = async (req, res, next) => {
    try {
        console.log('🚀 Fetching dashboard summary...');
        const startTime = Date.now();

        // Run independent queries in parallel
        const [
            totalProjects,
            runningProjects,
            completedProjects,
            totalSiteManagers,
            totalLabours,
            expensesResult,
            projects
        ] = await Promise.all([
            Project.estimatedDocumentCount(), // Faster than countDocuments
            Project.countDocuments({ status: 'running' }),
            Project.countDocuments({ status: 'completed' }),
            User.countDocuments({ role: 'sitemanager', active: true }),
            Labour.countDocuments({ active: true }),
            Expense.aggregate([
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Project.find()
                .select('name location status budget expenses assignedManager') // Select only needed fields
                .populate('assignedManager', 'name email')
                .lean() // Plain JavaScript objects, faster
                .limit(10) // Limit potential massive list on dashboard
        ]);

        const totalExpenses = expensesResult.length > 0 ? expensesResult[0].total : 0;

        console.log(`⚡ Dashboard data fetched in ${Date.now() - startTime}ms`);

        res.json({
            success: true,
            data: {
                totalProjects,
                runningProjects,
                completedProjects,
                totalSiteManagers,
                totalLabours,
                totalExpenses,
                projects
            }
        });
    } catch (error) {
        next(error);
    }
};

// ============ PROJECTS ============

// Get all projects
const getProjects = async (req, res, next) => {
    try {
        const projects = await Project.find()
            .populate('assignedManager', 'name email')
            .sort('-createdAt')
            .lean();
        res.json({
            success: true,
            data: projects
        });
    } catch (error) {
        next(error);
    }
};

// Get single project detail
const getProjectDetail = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Validate ID
        if (!id || id === 'undefined' || id === 'null') {
            return res.status(400).json({
                success: false,
                error: 'Invalid project ID'
            });
        }

        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid project ID format'
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

        // Optimize: Fetch related data in parallel with specific project ID filters
        // This avoids fetching the entire collection and filtering in memory or frontend
        const [expenses, labours, stocks, machines, contractors, reports] = await Promise.all([
            Expense.find({ projectId: id }).lean(),
            Labour.find({ assignedSite: id }).lean(),
            Stock.find({ projectId: id }).populate('vendorId', 'name').sort('-createdAt').lean(),
            Machine.find({ $or: [{ projectId: id }, { 'assignments.projectId': id }] }).sort('-createdAt').lean(),
            Contractor.find({ assignedProjects: id }).lean(),
            DailyReport.find({ projectId: id }).sort('-createdAt').lean()
        ]);

        res.json({
            success: true,
            data: {
                project,
                expenses,
                labours,
                stocks,
                machines,
                contractors,
                reports
            }
        });
    } catch (error) {
        next(error);
    }
};

// Create new project
const createProject = async (req, res, next) => {
    try {
        const { name, location, budget, startDate, endDate, description, assignedManager } = req.body;

        const newProject = new Project({
            name,
            location,
            budget: parseFloat(budget) || 0,
            startDate,
            endDate,
            description,
            assignedManager,
            roadDistanceValue: parseFloat(req.body.roadDistanceValue) || 0,
            roadDistanceUnit: req.body.roadDistanceUnit || 'km'
        });

        await newProject.save();

        // Update site manager's assigned sites if manager is assigned
        if (assignedManager) {
            await User.findByIdAndUpdate(
                assignedManager,
                { $addToSet: { assignedSites: newProject._id } }
            );
        }

        // Auto-assign new project to ALL existing site managers
        console.log('🔧 Auto-assigning new project to all site managers...');
        const allSiteManagers = await User.find({ role: 'sitemanager', active: true });

        if (allSiteManagers.length > 0) {
            // Add new project to all site managers
            await User.updateMany(
                { role: 'sitemanager', active: true },
                { $addToSet: { assignedSites: newProject._id } }
            );

            console.log(`✅ Auto-assigned project "${name}" to ${allSiteManagers.length} site managers`);
        }

        res.status(201).json({
            success: true,
            message: 'Project created successfully',
            data: newProject
        });
    } catch (error) {
        next(error);
    }
};

// Update project
const updateProject = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Get the old project to check manager change
        const oldProject = await Project.findById(id);
        if (!oldProject) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        const project = await Project.findByIdAndUpdate(
            id,
            updates,
            { new: true, runValidators: true }
        );

        if (!project) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        // Handle site manager assignment changes
        const oldManagerId = oldProject.assignedManager?.toString();
        const newManagerId = updates.assignedManager;

        if (oldManagerId !== newManagerId) {
            // Remove project from old manager's assigned sites
            if (oldManagerId) {
                await User.findByIdAndUpdate(
                    oldManagerId,
                    { $pull: { assignedSites: id } }
                );
            }

            // Add project to new manager's assigned sites
            if (newManagerId) {
                await User.findByIdAndUpdate(
                    newManagerId,
                    { $addToSet: { assignedSites: id } }
                );
            }
        }

        // If project marked completed now, move it from contractors' assignedProjects to their projectHistory
        if (updates.status === 'completed' && oldProject.status !== 'completed') {
            try {
                const projectObjectId = new mongoose.Types.ObjectId(id);
                const contractors = await Contractor.find({ assignedProjects: projectObjectId });
                console.log(`Found ${contractors.length} contractors for project ${id}`);

                for (const c of contractors) {
                    console.log(`Processing contractor: ${c.name}, assignedProjects before: ${c.assignedProjects.length}`);

                    c.projectHistory = c.projectHistory || [];
                    c.projectHistory.push({ projectId: project._id, name: project.name, completedAt: new Date() });
                    c.assignedProjects = (c.assignedProjects || []).filter(pid => !pid.equals(projectObjectId));

                    await c.save();
                    console.log(`✅ Updated contractor ${c.name}, projectHistory now has ${c.projectHistory.length} entries`);
                }
            } catch (err) {
                console.error('Error updating contractor project history:', err);
            }
        }

        res.json({
            success: true,
            message: 'Project updated successfully',
            data: project
        });
    } catch (error) {
        next(error);
    }
};

// Delete project
const deleteProject = async (req, res, next) => {
    try {
        const { id } = req.params;

        const project = await Project.findByIdAndDelete(id);

        if (!project) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        // Delete related data
        await Expense.deleteMany({ projectId: id });
        await Labour.updateMany({ assignedSite: id }, { assignedSite: null });

        res.json({
            success: true,
            message: 'Project deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};

// ============ USERS ============

// Get all users (site managers)
const getUsers = async (req, res, next) => {
    try {
        const users = await User.find({ role: 'sitemanager' })
            .select('-password')
            .sort('-createdAt')
            .lean();

        res.json({
            success: true,
            data: users
        });
    } catch (error) {
        next(error);
    }
};

// Create new user (site manager)
const createUser = async (req, res, next) => {
    try {
        const { name, email, password, phone, salary, dateOfJoining, role } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'User with this email already exists'
            });
        }

        const newUser = new User({
            name,
            email: email.toLowerCase(),
            password,
            phone,
            salary: parseFloat(salary) || 0,
            dateOfJoining: dateOfJoining || Date.now(),
            role: role || 'sitemanager',
            active: true
        });

        await newUser.save();

        // If user is a site manager, automatically assign all existing projects
        if (newUser.role === 'sitemanager') {
            console.log('🔧 Auto-assigning all projects to new site manager:', newUser.name);

            // Get all existing projects
            const allProjects = await Project.find({});
            if (allProjects.length > 0) {
                // Assign all project IDs to the new site manager
                newUser.assignedSites = allProjects.map(project => project._id);
                await newUser.save();

                console.log(`✅ Assigned ${allProjects.length} projects to site manager ${newUser.name}`);
            } else {
                console.log('ℹ️ No projects found to assign');
            }
        }

        // Remove password from response
        const userResponse = newUser.toObject();
        delete userResponse.password;

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: userResponse
        });
    } catch (error) {
        next(error);
    }
};

// Update user
const updateUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // If password is being updated, it will be hashed by the pre-save hook
        const user = await User.findById(id);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Update fields
        Object.keys(updates).forEach(key => {
            user[key] = updates[key];
        });

        await user.save();

        // Remove password from response
        const userResponse = user.toObject();
        delete userResponse.password;

        res.json({
            success: true,
            message: 'User updated successfully',
            data: userResponse
        });
    } catch (error) {
        next(error);
    }
};

// Delete user
const deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;

        const user = await User.findByIdAndDelete(id);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};

// ============ VENDORS ============

// Get all vendors
const getVendors = async (req, res, next) => {
    try {
        const vendors = await Vendor.find().sort('-createdAt');
        
        // Auto-fix vendor balances using strict chronological manual ledger
        const Stock = require('../models/Stock');
        const VendorPayment = require('../models/VendorPayment');
        
        for (const v of vendors) {
            const stocks = await Stock.find({ vendorId: v._id }).sort('createdAt');
            const payments = await VendorPayment.find({ vendorId: v._id }).sort('date');
            
            const ledger = [];
            stocks.forEach(s => ledger.push({ type: 'stock', date: s.createdAt, amount: s.totalPrice || 0 }));
            payments.forEach(p => ledger.push({ 
                type: 'payment', 
                date: p.date, 
                paid: p.amount || 0, 
                deduction: p.deduction || 0,
                advanceRecovered: p.advanceRecovered || 0 
            }));
            
            ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
            
            let pending = 0;
            let advance = 0;
            let totalSupplied = 0;
            
            for (const entry of ledger) {
                if (entry.type === 'stock') {
                    pending += entry.amount;
                    totalSupplied += entry.amount;
                } else if (entry.type === 'payment') {
                    const reduction = entry.paid + entry.deduction + entry.advanceRecovered;
                    pending -= reduction;
                    advance -= entry.advanceRecovered;
                    if (pending < 0) {
                        advance += Math.abs(pending);
                        pending = 0;
                    }
                    advance = Math.max(0, advance);
                }
            }
            
            if (v.totalSupplied !== totalSupplied || v.pendingAmount !== pending || v.advancePayment !== advance) {
                v.totalSupplied = totalSupplied;
                v.pendingAmount = pending;
                v.advancePayment = advance;
                await v.save();
            }
        }
        
        const fixedVendors = await Vendor.find().sort('-createdAt').lean();

        res.json({
            success: true,
            data: fixedVendors
        });
    } catch (error) {
        next(error);
    }
};

// Create new vendor
const createVendor = async (req, res, next) => {
    try {
        const { name, contact, email, address } = req.body;

        // Upload documents to Cloudinary if files exist
        let documentsUrls = [];
        if (req.files && req.files.length > 0) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            for (const file of req.files) {
                const url = await uploadToCloudinary(file.buffer, 'vendors');
                documentsUrls.push(url);
            }
        }

        const newVendor = new Vendor({
            name,
            contact,
            email: email ? email.toLowerCase() : undefined,
            address,
            documents: documentsUrls
        });

        await newVendor.save();

        res.status(201).json({
            success: true,
            message: 'Vendor created successfully',
            data: newVendor
        });
    } catch (error) {
        next(error);
    }
};

// Update vendor
const updateVendor = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const vendor = await Vendor.findByIdAndUpdate(
            id,
            updates,
            { new: true, runValidators: true }
        );

        if (!vendor) {
            return res.status(404).json({
                success: false,
                error: 'Vendor not found'
            });
        }

        res.json({
            success: true,
            message: 'Vendor updated successfully',
            data: vendor
        });
    } catch (error) {
        next(error);
    }
};

// Delete vendor
const deleteVendor = async (req, res, next) => {
    try {
        const { id } = req.params;

        const vendor = await Vendor.findByIdAndDelete(id);

        if (!vendor) {
            return res.status(404).json({
                success: false,
                error: 'Vendor not found'
            });
        }

        res.json({
            success: true,
            message: 'Vendor deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};

// Record vendor payment
const recordVendorPayment = async (req, res, next) => {
    try {
        const { vendorId, amount, paymentMode, date, remarks, bankId, creditorId } = req.body;

        const vendor = await Vendor.findById(vendorId);

        if (!vendor) {
            return res.status(404).json({
                success: false,
                error: 'Vendor not found'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Please upload payment slip / receipt image'
            });
        }

        const { uploadToCloudinary } = require('../config/cloudinary');
        const receiptUrl = await uploadToCloudinary(req.file.buffer, 'payments');

        const paidAmount = parseFloat(amount || 0);
        const deductionAmount = parseFloat(req.body.deduction || 0);
        const advanceRecoveredAmount = parseFloat(req.body.advanceRecovered || 0);

        const currentPending = vendor.pendingAmount || 0;
        const currentAdvance = vendor.advancePayment || 0;

        // Total amount that reduces the pending balance
        // (Cash Paid + Manual Deduction + Advance Adjusted)
        const totalReduction = paidAmount + deductionAmount + advanceRecoveredAmount;

        let newPending = currentPending - totalReduction;
        let newAdvance = currentAdvance - advanceRecoveredAmount;

        if (newPending < 0) {
            // If total reduction exceeds pending, the excess goes to advance
            // Note: usually only the cash part creates advance, but we follow the logic:
            // excess reduction increases advance account
            newAdvance += Math.abs(newPending);
            newPending = 0;
        }

        vendor.pendingAmount = newPending;
        vendor.advancePayment = Math.max(0, newAdvance);

        const newPayment = new VendorPayment({
            vendorId,
            amount: paidAmount,
            deduction: deductionAmount,
            advanceRecovered: advanceRecoveredAmount,
            date: date || new Date(),
            paymentMode,
            bankId: bankId && bankId !== '' ? bankId : undefined,
            creditorId: creditorId && creditorId !== '' ? creditorId : undefined,
            remarks,
            recordedBy: req.user._id,
            isAdvance: req.body.isAdvance === 'true' || req.body.isAdvance === true,
            receiptUrl
        });

        await vendor.save();
        await newPayment.save();

        // If bankId is provided, record transaction in bank
        if (bankId && bankId !== '') {
            await BankDetail.findByIdAndUpdate(bankId, {
                $inc: { currentBalance: -paidAmount },
                $push: {
                    transactions: {
                        type: 'debit',
                        amount: paidAmount,
                        date: date || new Date(),
                        description: `Payment to vendor: ${vendor.name}`,
                        refId: newPayment._id,
                        refModel: 'VendorPayment'
                    }
                }
            });
        }

        if (creditorId && creditorId !== '') {
            await Creditor.findByIdAndUpdate(creditorId, {
                $inc: { currentBalance: -parseFloat(paidAmount) }, // Payment reduces balance (Debit)
                $push: {
                    transactions: {
                        type: 'debit',
                        amount: parseFloat(paidAmount),
                        date: date || new Date(),
                        description: `Payment for vendor: ${vendor.name}`,
                        refId: newPayment._id,
                        refModel: 'VendorPayment'
                    }
                }
            });
        }

        res.json({
            success: true,
            message: 'Payment recorded successfully',
            data: vendor
        });
    } catch (error) {
        next(error);
    }
};

// Get vendor payments
const getVendorPayments = async (req, res, next) => {
    try {
        const { vendorId } = req.params;

        const payments = await VendorPayment.find({ vendorId })
            .populate('vendorId', 'name contact')
            .sort('-createdAt')
            .lean();

        res.json({
            success: true,
            data: payments
        });
    } catch (error) {
        next(error);
    }
};

// ============ EXPENSES ============

// Get all expenses
const getExpenses = async (req, res, next) => {
    try {
        const [expenses, vendorPayments, contractorPayments, labourPayments] = await Promise.all([
            Expense.find()
                .populate('projectId', 'name location')
                .populate('addedBy', 'name email')
                .sort('-createdAt')
                .lean(),
            VendorPayment.find()
                .populate('vendorId', 'name')
                .populate('recordedBy', 'name')
                .sort('-createdAt')
                .lean(),
            ContractorPayment.find()
                .populate('contractorId', 'name')
                .populate('projectId', 'name')
                .populate('paidBy', 'name')
                .sort('-createdAt')
                .lean(),
            LabourPayment.find()
                .populate('labourId', 'name')
                .populate('userId', 'name')
                .sort('-createdAt')
                .lean()
        ]);

        // Transform vendor payments to expense format
        const vendorExpenses = vendorPayments.map(vp => ({
            _id: vp._id,
            projectId: { name: 'Vendor Payment' },
            name: `Payment to ${vp.vendorId?.name || 'Vendor'}`,
            amount: vp.amount || 0,
            category: 'vendor',
            voucherNumber: vp._id.toString().slice(-8).toUpperCase(),
            remarks: vp.remarks || 'Vendor payment',
            addedBy: vp.recordedBy,
            createdAt: vp.date || vp.createdAt,
            isPayment: true
        }));

        // Transform contractor payments to expense format
        const contractorExpenses = contractorPayments.map(cp => ({
            _id: cp._id,
            projectId: cp.projectId || { name: 'Contractor Payment' },
            name: `Payment to ${cp.contractorId?.name || cp.contractorName || 'Contractor'}`,
            amount: cp.amount || cp.advance || 0,
            category: 'contractor',
            voucherNumber: cp._id.toString().slice(-8).toUpperCase(),
            remarks: cp.remark || 'Contractor payment',
            addedBy: cp.paidBy,
            createdAt: cp.date || cp.createdAt,
            isPayment: true
        }));

        // Transform labour payments to expense format
        const labourExpenses = labourPayments.map(lp => ({
            _id: lp._id,
            projectId: { name: 'Labour Payment' },
            name: `Payment to ${lp.labourId?.name || 'Labour'}`,
            amount: lp.amount || 0,
            category: 'labour',
            voucherNumber: lp._id.toString().slice(-8).toUpperCase(),
            remarks: lp.remarks || 'Labour payment',
            addedBy: lp.userId,
            createdAt: lp.date || lp.createdAt,
            isPayment: true
        }));

        // Combine all and sort by date
        const allExpenses = [...expenses, ...vendorExpenses, ...contractorExpenses, ...labourExpenses]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({
            success: true,
            data: allExpenses
        });
    } catch (error) {
        next(error);
    }
};

// Create new expense
const createExpense = async (req, res, next) => {
    try {
        const { projectId, name, amount, voucherNumber, category, remarks, paymentMode, bankId, creditorId, date } = req.body;

        // Upload receipt to Cloudinary if file exists
        let receiptUrl = null;
        if (req.file) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            receiptUrl = await uploadToCloudinary(req.file.buffer, 'expenses');
        }

        const newExpense = new Expense({
            projectId,
            name,
            amount: parseFloat(amount),
            voucherNumber,
            category: category || 'material',
            remarks,
            receipt: receiptUrl,
            paymentMode: paymentMode || 'cash',
            bankId: bankId && bankId !== '' ? bankId : undefined,
            creditorId: creditorId && creditorId !== '' ? creditorId : undefined,
            addedBy: req.user.userId
        });

        await newExpense.save();

        // Update project expenses
        await Project.findByIdAndUpdate(
            projectId,
            { $inc: { expenses: parseFloat(amount) } }
        );

        // If bankId is provided, record transaction in bank
        if (bankId && bankId !== '') {
            await BankDetail.findByIdAndUpdate(bankId, {
                $inc: { currentBalance: -parseFloat(amount) },
                $push: {
                    transactions: {
                        type: 'debit',
                        amount: parseFloat(amount),
                        date: new Date(),
                        description: `Expense: ${name} (Voucher: ${voucherNumber || 'N/A'})`,
                        refId: newExpense._id,
                        refModel: 'Expense'
                    }
                }
            });
        }

        if (creditorId && creditorId !== '') {
            await Creditor.findByIdAndUpdate(creditorId, {
                $inc: { currentBalance: -parseFloat(amount) }, // Expense reduces balance (Debit)
                $push: {
                    transactions: {
                        type: 'debit',
                        amount: parseFloat(amount),
                        date: date || new Date(),
                        description: `Expense: ${name} (Voucher: ${voucherNumber})`,
                        refId: newExpense._id,
                        refModel: 'Expense'
                    }
                }
            });
        }

        res.status(201).json({
            success: true,
            message: 'Expense added successfully',
            data: newExpense
        });
    } catch (error) {
        next(error);
    }
};

// Delete expense
const deleteExpense = async (req, res, next) => {
    try {
        const { id } = req.params;

        const expense = await Expense.findById(id);

        if (!expense) {
            return res.status(404).json({
                success: false,
                error: 'Expense not found'
            });
        }

        // Update project expenses
        await Project.findByIdAndUpdate(
            expense.projectId,
            { $inc: { expenses: -expense.amount } }
        );

        // If expense was paid via bank, reverse the transaction
        if (expense.bankId) {
            await BankDetail.findByIdAndUpdate(expense.bankId, {
                $inc: { currentBalance: expense.amount },
                $pull: { transactions: { refId: expense._id } }
            });
        }

        // If expense was on credit, reverse the creditor transaction
        if (expense.creditorId) {
            const Creditor = require('../models/Creditor');
            await Creditor.findByIdAndUpdate(expense.creditorId, {
                $inc: { currentBalance: expense.amount }, // Reverse the debit by adding the amount back
                $pull: { transactions: { refId: expense._id } }
            });
        }

        await expense.deleteOne();

        res.json({
            success: true,
            message: 'Expense deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};

// ============ LABOURS ============

// Get all labours
const getLabours = async (req, res, next) => {
    try {
        const labours = await Labour.find()
            .populate('assignedSite', 'name location')
            .populate('enrolledBy', 'name email')
            .sort('-createdAt')
            .lean();

        res.json({
            success: true,
            data: labours
        });
    } catch (error) {
        next(error);
    }
};

// ============ CONTRACTORS ============

const getContractors = async (req, res, next) => {
    try {
        const contractors = await Contractor.find()
            .populate('assignedProjects', 'name')
            .sort('-createdAt')
            .lean();

        res.json({
            success: true,
            data: contractors
        });
    } catch (error) {
        next(error);
    }
};

const createContractor = async (req, res, next) => {
    try {
        // Upload documents to Cloudinary if files exist
        let documentsUrls = [];
        if (req.files && req.files.length > 0) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            for (const file of req.files) {
                const url = await uploadToCloudinary(file.buffer, 'contractors');
                documentsUrls.push(url);
            }
        }

        const contractor = new Contractor({
            ...req.body,
            assignedProjects: req.body.assignedProjectId ? [req.body.assignedProjectId] : [],
            activeAssignments: req.body.assignedProjectId ? [{
                projectId: req.body.assignedProjectId,
                assignedAt: new Date(),
                distanceValue: req.body.distanceValue || 0,
                distanceUnit: req.body.distanceUnit || 'km',
                expensePerUnit: req.body.expensePerUnit || 0,
                totalPaid: 0,
                advancePayment: 0
            }] : [],
            documents: documentsUrls
        });
        await contractor.save();
        res.status(201).json({
            success: true,
            message: 'Contractor created successfully',
            data: contractor
        });
    } catch (error) {
        next(error);
    }
};

const updateContractor = async (req, res, next) => {
    try {
        const { id } = req.params;
        const contractor = await Contractor.findById(id);
        if (!contractor) {
            return res.status(404).json({
                success: false,
                error: 'Contractor not found'
            });
        }

        const isCompleting = req.body.status === 'complete' && contractor.status !== 'complete';
        const isAssigningNewProject = req.body.isAssigningNewProject === true;
        const targetProjectIdToComplete = req.body.targetProjectIdToComplete;

        // 1. Complete a specific active project
        if (targetProjectIdToComplete) {
            const assignmentIndex = contractor.activeAssignments.findIndex(a => a.projectId && a.projectId.toString() === targetProjectIdToComplete);
            if (assignmentIndex !== -1) {
                const assignment = contractor.activeAssignments[assignmentIndex];
                let projName = 'Unassigned Contract';
                const proj = await Project.findById(assignment.projectId);
                if (proj) projName = proj.name;

                contractor.projectHistory.push({
                    projectId: assignment.projectId,
                    name: projName,
                    assignedAt: assignment.assignedAt,
                    completedAt: new Date(),
                    distanceValue: assignment.distanceValue,
                    distanceUnit: assignment.distanceUnit,
                    expensePerUnit: assignment.expensePerUnit,
                    totalPaid: assignment.totalPaid,
                    advancePayment: assignment.advancePayment,
                    totalMachineRent: req.body.currentTotalMachineRent || 0
                });

                contractor.activeAssignments.splice(assignmentIndex, 1);
                contractor.assignedProjects = contractor.assignedProjects.filter(id => id.toString() !== targetProjectIdToComplete);
            }
        }

        // 2. Assigning a New Project
        if (isAssigningNewProject && req.body.assignedProjectId) {
            // Check if already assigned
            if (!contractor.assignedProjects.includes(req.body.assignedProjectId)) {
                contractor.assignedProjects.push(req.body.assignedProjectId);
                contractor.activeAssignments.push({
                    projectId: req.body.assignedProjectId,
                    assignedAt: new Date(),
                    distanceValue: req.body.distanceValue || 0,
                    distanceUnit: req.body.distanceUnit || 'km',
                    expensePerUnit: req.body.expensePerUnit || 0,
                    totalPaid: 0,
                    advancePayment: 0
                });
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'Contractor is already assigned to this specific project'
                });
            }
        }

        // 3. Completing the entire contractor
        if (isCompleting && contractor.activeAssignments.length > 0) {
            for (const assignment of contractor.activeAssignments) {
                let projName = 'Unassigned Contract';
                if (assignment.projectId) {
                    const proj = await Project.findById(assignment.projectId);
                    if (proj) projName = proj.name;
                }
                contractor.projectHistory.push({
                    projectId: assignment.projectId,
                    name: projName,
                    assignedAt: assignment.assignedAt,
                    completedAt: new Date(),
                    distanceValue: assignment.distanceValue,
                    distanceUnit: assignment.distanceUnit,
                    expensePerUnit: assignment.expensePerUnit,
                    totalPaid: assignment.totalPaid,
                    advancePayment: assignment.advancePayment,
                    totalMachineRent: req.body.currentTotalMachineRent || 0
                });
            }
            contractor.activeAssignments = [];
            contractor.assignedProjects = [];
            contractor.status = 'complete';
        }

        // 4. Update basic info (only if not completing specific project)
        if (!targetProjectIdToComplete && !isAssigningNewProject) {
            contractor.name = req.body.name || contractor.name;
            contractor.mobile = req.body.mobile || contractor.mobile;
            contractor.address = req.body.address || contractor.address;
            if (req.body.status) contractor.status = req.body.status;
            
            // For backward compatibility with UI form
            if (contractor.activeAssignments.length > 0 && req.body.distanceValue !== undefined) {
                contractor.activeAssignments[0].distanceValue = req.body.distanceValue;
                contractor.activeAssignments[0].distanceUnit = req.body.distanceUnit;
                contractor.activeAssignments[0].expensePerUnit = req.body.expensePerUnit;
            }
        }

        await contractor.save();

        await contractor.populate('assignedProjects', 'name');

        res.json({
            success: true,
            message: 'Contractor updated successfully',
            data: contractor
        });
    } catch (error) {
        next(error);
    }
};

const deleteContractor = async (req, res, next) => {
    try {
        const { id } = req.params;
        const contractor = await Contractor.findByIdAndDelete(id);
        if (!contractor) {
            return res.status(404).json({
                success: false,
                error: 'Contractor not found'
            });
        }
        res.json({
            success: true,
            message: 'Contractor deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};

const getContractorPayments = async (req, res, next) => {
    try {
        const { contractorId } = req.params;
        const payments = await ContractorPayment.find({ contractorId }).sort('-createdAt').lean();
        res.json({
            success: true,
            data: payments
        });
    } catch (error) {
        next(error);
    }
};

const createContractorPayment = async (req, res, next) => {
    try {
        const { contractorId, contractorName, date, amount, paymentMode, remarks, machineRent, rentDeducted, bankId, creditorId, isAdvance, advanceRecovered } = req.body;
        const userId = req.user.userId;

        const contractor = await Contractor.findById(contractorId);
        if (!contractor) {
            return res.status(404).json({ success: false, error: 'Contractor not found' });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Please upload payment slip / receipt image'
            });
        }

        const { uploadToCloudinary } = require('../config/cloudinary');
        const receiptUrl = await uploadToCloudinary(req.file.buffer, 'payments');

        const paidAmount = parseFloat(amount) || 0;
        const rentDeductedVal = parseFloat(rentDeducted) || 0;
        const advanceRecoveredVal = parseFloat(advanceRecovered) || 0;

        // Create Payment Record
        // Parse projectId prefix (hist_ or curr_) BEFORE creating payment record
        let isPastProject = false;
        let actualProjectId = req.body.projectId;

        if (req.body.projectId) {
            const rawId = String(req.body.projectId).trim();
            if (rawId.startsWith('hist_')) {
                isPastProject = true;
                actualProjectId = rawId.replace('hist_', '');
            } else if (rawId.startsWith('curr_')) {
                isPastProject = false;
                actualProjectId = rawId.replace('curr_', '');
            }
        }

        // Determine the clean projectId for the payment record
        const paymentProjectId = (actualProjectId && String(actualProjectId).trim() !== '')
            ? actualProjectId
            : (contractor.activeAssignments && contractor.activeAssignments.length > 0
                ? contractor.activeAssignments[0].projectId
                : undefined);

        const payment = new ContractorPayment({
            contractorId,
            contractorName: contractor.name,
            projectId: paymentProjectId,
            amount: paidAmount,
            date: date || Date.now(),
            remark: remarks,
            paymentMode: paymentMode || 'cash',
            bankId: bankId && bankId !== '' ? bankId : undefined,
            creditorId: creditorId && creditorId !== '' ? creditorId : undefined,
            recordedBy: userId,
            machineRent: rentDeductedVal,
            isAdvance: isAdvance === 'true' || isAdvance === true,
            receiptUrl
        });
        await payment.save();

        // Update Contractor Financials (Advance/Pending) - ONLY FOR CURRENT PROJECT
        if (!isPastProject) {
            const assignmentIndex = contractor.activeAssignments.findIndex(a => {
                const aProjId = a.projectId ? a.projectId.toString() : 'unassigned';
                const pProjId = (paymentProjectId && paymentProjectId !== 'null' && paymentProjectId !== 'undefined') ? paymentProjectId.toString() : 'unassigned';
                return aProjId === pProjId;
            });
            
            if (assignmentIndex !== -1) {
                const assignment = contractor.activeAssignments[assignmentIndex];
                let currentPending = assignment.pendingAmount || 0;
                const currentAdvance = assignment.advancePayment || 0;
                const totalWorkAmount = (assignment.distanceValue || 0) * (assignment.expensePerUnit || 0);

                if (currentPending === 0 && totalWorkAmount > 0 && (assignment.totalPaid || 0) === 0) {
                    currentPending = totalWorkAmount;
                }

                if (isAdvance === 'true' || isAdvance === true) {
                    assignment.advancePayment = currentAdvance + paidAmount;
                } else {
                    const reducePending = paidAmount + rentDeductedVal + advanceRecoveredVal;
                    let newPending = currentPending - reducePending;

                    if (newPending < 0) {
                        assignment.advancePayment = currentAdvance + Math.abs(newPending) - advanceRecoveredVal;
                        assignment.pendingAmount = 0;
                    } else {
                        assignment.pendingAmount = newPending;
                        if (advanceRecoveredVal > 0) {
                            assignment.advancePayment = Math.max(0, currentAdvance - advanceRecoveredVal);
                        }
                    }
                }
                assignment.totalPaid = (assignment.totalPaid || 0) + paidAmount;

                // Backward compatibility: If it's the first active assignment, mirror it to root
                if (assignmentIndex === 0) {
                    contractor.advancePayment = assignment.advancePayment;
                    contractor.totalPaid = assignment.totalPaid;
                    contractor.pendingAmount = assignment.pendingAmount;
                }
            }
        }

        // Update projectHistory entry if payment is for a past project
        if (isPastProject && contractor.projectHistory && contractor.projectHistory.length > 0) {
            const historyIndex = contractor.projectHistory.findIndex(h => 
                (h._id && String(h._id) === actualProjectId) || String(h.projectId) === actualProjectId
            );
            if (historyIndex !== -1) {
                const histEntry = contractor.projectHistory[historyIndex];
                if (isAdvance === 'true' || isAdvance === true) {
                    histEntry.advancePayment = (histEntry.advancePayment || 0) + paidAmount;
                } else {
                    histEntry.totalPaid = (histEntry.totalPaid || 0) + paidAmount;
                }
                contractor.projectHistory[historyIndex] = histEntry;
                contractor.markModified('projectHistory');
            }
        }

        await contractor.save();

        // If bankId is provided, record transaction in bank
        if (bankId && bankId !== '') {
            await BankDetail.findByIdAndUpdate(bankId, {
                $inc: { currentBalance: -paidAmount },
                $push: {
                    transactions: {
                        type: 'debit',
                        amount: paidAmount,
                        date: date || new Date(),
                        description: `Payment to contractor: ${contractor.name}`,
                        refId: payment._id,
                        refModel: 'ContractorPayment'
                    }
                }
            });
        }

        // If creditorId is provided (Credit Payment), update creditor balance
        if (creditorId && creditorId !== '') {
            await Creditor.findByIdAndUpdate(creditorId, {
                $inc: { currentBalance: -parseFloat(paidAmount) }, // Payment reduces balance (Debit)
                $push: {
                    transactions: {
                        type: 'debit',
                        amount: parseFloat(paidAmount),
                        date: date || new Date(),
                        description: `Payment to contractor: ${contractor.name}`,
                        refId: payment._id,
                        refModel: 'ContractorPayment'
                    }
                }
            });
        }



        res.status(201).json({
            success: true,
            message: 'Payment recorded successfully',
            data: payment
        });
    } catch (error) {
        next(error);
    }
};

// Placeholder functions for other features
const getMachines = async (req, res, next) => {
    try {
        const machines = await Machine.find()
            .populate('projectId', 'name location')
            .sort('-createdAt')
            .limit(200)
            .lean();

        console.log(`🔍 [getMachines] Fetched ${machines.length} machines from database`);
        console.log(`🔍 [getMachines] Sample data:`, machines.slice(0, 2));

        res.json({
            success: true,
            data: machines
        });
    } catch (error) {
        next(error);
    }
};

const createMachine = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Please upload a photo for the machine'
            });
        }

        // Upload photo to Cloudinary
        let machinePhotoUrl = null;
        const { uploadToCloudinary } = require('../config/cloudinary');
        machinePhotoUrl = await uploadToCloudinary(req.file.buffer, 'machines');

        const initialStatus = req.body.status || 'available';
        const availableLocation = (req.body.availableLocation || '').trim();
        if (initialStatus === 'available' && req.body.category !== 'consumables' && !availableLocation) {
            return res.status(400).json({
                success: false,
                error: 'Please enter where the machine is available'
            });
        }
        const machineData = {
            ...req.body,
            machinePhoto: machinePhotoUrl,
            // Convert empty string to null for optional ObjectId fields
            projectId: req.body.projectId && req.body.projectId.trim() !== '' ? req.body.projectId : null,
            creditorId: req.body.creditorId && req.body.creditorId.trim() !== '' ? req.body.creditorId : null,
            availableLocation: initialStatus === 'available' ? availableLocation : '',
            rentedAt: req.body.ownershipType === 'rented' ? new Date() : null
        };

        const machine = new Machine(machineData);
        await machine.save();
        res.status(201).json({
            success: true,
            message: 'Machine added successfully',
            data: machine
        });
    } catch (error) {
        next(error);
    }
};

const updateMachine = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const { maintenanceCost, maintenanceDescription } = req.body;

        const machine = await Machine.findById(id);
        if (!machine) {
            return res.status(404).json({ success: false, error: 'Machine not found' });
        }

        if (machine.status === 'returned') {
            return res.status(400).json({
                success: false,
                error: 'Returned machines cannot be assigned or edited'
            });
        }

        // Handle Photo Upload
        if (req.file) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            const url = await uploadToCloudinary(req.file.buffer, 'machines');
            updates.machinePhoto = url;
        }

        // Handle Status Changes for Maintenance
        if (updates.status === 'maintenance' && machine.status !== 'maintenance') {
            // Starting maintenance
            updates.maintenanceHistory = machine.maintenanceHistory || [];
            updates.maintenanceHistory.push({
                enteredAt: new Date(),
                description: updates.remarks || 'Routine Maintenance'
            });
        } else if (machine.status === 'maintenance' && updates.status === 'available') {
            // Ending maintenance
            if (maintenanceCost && Number(maintenanceCost) > 0) {
                const history = machine.maintenanceHistory || [];
                const lastRecord = history[history.length - 1];
                if (lastRecord && !lastRecord.completedAt) {
                    lastRecord.completedAt = new Date();
                    lastRecord.cost = Number(maintenanceCost);
                    lastRecord.description = maintenanceDescription || lastRecord.description;
                    updates.maintenanceHistory = history;
                }

                // Create Expense
                const newExpense = new Expense({
                    projectId: machine.projectId, // Use existing project if available
                    name: `Maintenance: ${machine.name}`,
                    category: 'maintenance',
                    amount: Number(maintenanceCost),
                    date: new Date(),
                    remarks: maintenanceDescription || `Maintenance for ${machine.name}`,
                    paymentMode: 'cash',
                    addedBy: req.user.userId
                });
                await newExpense.save();

                // Update project expenses if assigned
                if (machine.projectId) {
                    await Project.findByIdAndUpdate(machine.projectId, { $inc: { expenses: Number(maintenanceCost) } });
                }
            }
        }

        // Detect when machine is leaving 'in-use' status (unassigned/made available/maintenance)
        const isLeavingInUse = machine.status === 'in-use' && (updates.status === 'available' || updates.status === 'maintenance' || updates.status === 'returned');
        
        if (isLeavingInUse) {
            const assignedDate = new Date(machine.assignedAt);
            const returnDate = new Date();
            const diffTime = Math.abs(returnDate - assignedDate); // Total milliseconds

            // --- Calculate Paused Duration ---
            let totalPausedMs = 0;
            if (machine.rentPausedHistory && machine.rentPausedHistory.length > 0) {
                machine.rentPausedHistory.forEach(pause => {
                    const pauseStart = new Date(pause.pausedAt).getTime();
                    const pauseEnd = pause.resumedAt ? new Date(pause.resumedAt).getTime() : returnDate.getTime();
                    if (pauseStart >= assignedDate.getTime()) {
                        const effectiveEnd = Math.min(pauseEnd, returnDate.getTime());
                        totalPausedMs += (effectiveEnd - pauseStart);
                    }
                });
            }

            if (machine.isRentPaused && machine.rentPausedAt) {
                const currentPauseStart = new Date(machine.rentPausedAt).getTime();
                if (currentPauseStart >= assignedDate.getTime()) {
                    totalPausedMs += (returnDate.getTime() - currentPauseStart);
                }
            }

            const billableMs = Math.max(0, diffTime - totalPausedMs);
            // Contractor/assignment rate is machine.assignedRentalPerDay
            const rate = parseFloat(machine.assignedRentalPerDay) || parseFloat(machine.perDayExpense) || 0;

            let totalRent = 0;
            let diffDisplay = '';
            let diffValue = 0;

            if (machine.assignedRentalType === 'perHour') {
                const hours = billableMs / (1000 * 60 * 60);
                totalRent = hours * rate;
                diffDisplay = `${hours.toFixed(2)} hrs`;
                diffValue = hours * 60;
            } else {
                const billableDays = billableMs / (1000 * 60 * 60 * 24);
                const chargeableDays = Math.ceil(billableDays);
                totalRent = chargeableDays * rate;
                diffDisplay = `${chargeableDays} days`;
                diffValue = chargeableDays;
            }

            if (isNaN(totalRent)) totalRent = 0;
            totalRent = Math.round(totalRent * 100) / 100;

            const contractorId = machine.assignedToContractor;
            const targetProjectId = machine.projectId;

            // Update machine statistics
            machine.returnedAt = returnDate;
            machine.projectId = null;
            machine.assignedToContractor = null;
            machine.assignedAsRental = false;
            machine.assignedRentalPerDay = 0;
            machine.assignedRentalType = 'perDay';
            machine.isRentPaused = false;
            machine.rentPausedAt = null;

            // Clear assignment fields from updates so they don't overwrite our cleared values
            delete updates.projectId;
            delete updates.assignedToContractor;
            delete updates.assignedAsRental;
            delete updates.assignedRentalPerDay;
            delete updates.assignedRentalType;
            delete updates.rentalType; // Prevent frontend unassign payload from resetting creditor's type
            delete updates.isRentPaused;
            delete updates.rentPausedAt;

            // Update History
            if (machine.assignmentHistory && machine.assignmentHistory.length > 0) {
                const lastIdx = machine.assignmentHistory.length - 1;
                machine.assignmentHistory[lastIdx].returnedAt = returnDate;
                machine.assignmentHistory[lastIdx].returnStatus = 'returned';
                machine.assignmentHistory[lastIdx].totalRent = totalRent;
                machine.assignmentHistory[lastIdx].durationMinutes = machine.assignedRentalType === 'perHour' ? diffValue : diffValue * 24 * 60;
            }

            // If unassigned from a contractor, it is Capital/Income deduction
            if (contractorId) {
                const Transaction = require('../models/Transaction');
                const transaction = new Transaction({
                    amount: totalRent,
                    type: 'credit',
                    category: 'capital',
                    description: `Machine Rent Income: ${machine.name} [${machine.plateNumber || ''}] from Contractor`,
                    paymentMode: 'cash',
                    date: returnDate,
                    addedBy: req.user.userId
                });
                await transaction.save();

                const Contractor = require('../models/Contractor');
                await Contractor.findByIdAndUpdate(contractorId, { $inc: { pendingAmount: -totalRent } });
            } else if (targetProjectId) {
                // If unassigned from a project directly (internal project usage), it is a project expense
                const expense = new Expense({
                    projectId: targetProjectId,
                    name: `Machine Project Usage: ${machine.name}${machine.plateNumber ? ' [' + machine.plateNumber + ']' : ''}`,
                    amount: totalRent,
                    category: 'machine_rental',
                    remarks: `${diffDisplay} @ ₹${rate}/${machine.rentalType === 'perHour' ? 'hr' : 'day'}. Assigned: ${assignedDate.toLocaleDateString()}, Unassigned: ${returnDate.toLocaleDateString()}`,
                    addedBy: req.user.userId
                });
                await expense.save();

                await Project.findByIdAndUpdate(targetProjectId, { $inc: { expenses: totalRent } });
            }
        }

        // Detect assignment transition (available -> in-use)
        const isNowInUse = updates.status === 'in-use' && machine.status !== 'in-use';
        const prevStatus = machine.status;

        // Normal updates
        Object.keys(updates).forEach(key => {
            if (key !== 'maintenanceCost' && key !== 'maintenanceDescription') {
                machine[key] = updates[key];
            }
        });

        const nextStatus = machine.status;
        const becomingAvailable = nextStatus === 'available' && prevStatus !== 'available';
        if (nextStatus !== 'available') {
            machine.availableLocation = '';
        } else {
            const loc = (updates.availableLocation ?? req.body.availableLocation ?? machine.availableLocation ?? '').trim();
            if (!loc && becomingAvailable) {
                return res.status(400).json({
                    success: false,
                    error: 'Please enter where the machine is available'
                });
            }
            if (loc) machine.availableLocation = loc;
        }

        // If newly assigned, record history
        if (isNowInUse) {
            if (!machine.assignmentHistory) machine.assignmentHistory = [];

            let histProjectId = machine.projectId;
            if (!histProjectId && machine.assignedToContractor) {
                const contractorObj = await Contractor.findById(machine.assignedToContractor);
                if (contractorObj && contractorObj.assignedProjects && contractorObj.assignedProjects.length > 0) {
                    histProjectId = contractorObj.assignedProjects[0];
                }
            }

            machine.assignmentHistory.push({
                assignedAt: machine.assignedAt || new Date(),
                projectId: histProjectId,
                assignedTo: machine.assignedToContractor || machine.projectId,
                assignedModel: machine.assignedToContractor ? 'Contractor' : 'Project',
                rate: machine.assignedRentalPerDay || machine.perDayExpense || 0,
                rentType: machine.rentalType || 'perDay',
                status: 'active'
            });
        }

        // Sanitize projectId
        if (updates.projectId === '' || updates.projectId === 'null') {
            machine.projectId = null;
        }

        await machine.save();

        res.json({
            success: true,
            message: 'Machine updated successfully',
            data: machine
        });
    } catch (error) {
        next(error);
    }
};

const deleteMachine = async (req, res, next) => {
    try {
        const { id } = req.params;
        const machine = await Machine.findByIdAndDelete(id);
        if (!machine) {
            return res.status(404).json({
                success: false,
                error: 'Machine not found'
            });
        }
        res.json({
            success: true,
            message: 'Machine deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};

// Return rented machine and create expense
const returnRentedMachine = async (req, res, next) => {
    try {
        const { id } = req.params;

        const machine = await Machine.findById(id);
        if (!machine) {
            return res.status(404).json({
                success: false,
                error: 'Machine not found'
            });
        }

        // Verify machine is in-use or available
        if (machine.status !== 'in-use' && machine.status !== 'available') {
            return res.status(400).json({
                success: false,
                error: 'Machine must be in use or available to be returned'
            });
        }

        // Calculate rental details
        const isRented = machine.ownershipType === 'rented';
        const assignedDate = isRented ? new Date(machine.rentedAt || machine.createdAt) : new Date(machine.assignedAt);
        const returnDate = new Date();
        const diffTime = Math.abs(returnDate - assignedDate); // Total milliseconds

        // --- Calculate Paused Duration ---
        let totalPausedMs = 0;

        // 1. Sum up closed pauses that happened AFTER assignment
        if (machine.rentPausedHistory && machine.rentPausedHistory.length > 0) {
            machine.rentPausedHistory.forEach(pause => {
                const pauseStart = new Date(pause.pausedAt).getTime();
                const pauseEnd = pause.resumedAt ? new Date(pause.resumedAt).getTime() : returnDate.getTime();

                // Only count pauses that started after assignment
                if (pauseStart >= assignedDate.getTime()) {
                    // Ensure we don't count beyond return date
                    const effectiveEnd = Math.min(pauseEnd, returnDate.getTime());
                    totalPausedMs += (effectiveEnd - pauseStart);
                }
            });
        }

        // 2. Add current open pause if active
        // Note: If isRentPaused is true, the current pause is NOT yet in rentPausedHistory (based on siteController logic)
        // OR it might be partially handled. 
        // Logic: active pause starts at machine.rentPausedAt.
        if (machine.isRentPaused && machine.rentPausedAt) {
            const currentPauseStart = new Date(machine.rentPausedAt).getTime();
            if (currentPauseStart >= assignedDate.getTime()) {
                totalPausedMs += (returnDate.getTime() - currentPauseStart);
            }
        }

        // Calculate Billable Duration
        const billableMs = Math.max(0, diffTime - totalPausedMs);

        // This is the RATE (either per day or per hour)
        const rate = isRented ? (parseFloat(machine.perDayExpense) || 0) : (parseFloat(machine.assignedAsRental ? machine.assignedRentalPerDay : machine.perDayExpense) || 0);

        let totalRent = 0;
        let diffDisplay = '';
        let diffValue = 0;

        if (machine.rentalType === 'perHour') {
            // Minute-based calculation
            // Use exact float hours to match Site Panel logic and avoid rounding discrepancies
            const hours = billableMs / (1000 * 60 * 60);
            totalRent = hours * rate;

            // For display/storage
            diffDisplay = `${hours.toFixed(2)} hrs`;
            diffValue = hours * 60; // Store minutes
        } else {
            // Day-based calculation
            // Logic: billableMs / DayMs. Math.ceil for full days?
            const billableDays = billableMs / (1000 * 60 * 60 * 24);
            // Site logic: Math.ceil(billableDays) * rate
            const chargeableDays = Math.ceil(billableDays);

            totalRent = chargeableDays * rate;
            diffDisplay = `${chargeableDays} days`;
            diffValue = chargeableDays;
        }

        if (isNaN(totalRent)) totalRent = 0;
        totalRent = Math.round(totalRent * 100) / 100; // Round to 2 decimals

        // Store IDs before clearing
        const contractorId = machine.assignedToContractor;
        const targetProjectId = machine.projectId;

        // Update machine status and clear assignments
        const willBeAvailable = machine.ownershipType !== 'rented';
        machine.status = willBeAvailable ? 'available' : 'returned';
        if (willBeAvailable) {
            const returnLocation = (req.body.availableLocation || '').trim();
            if (!returnLocation) {
                return res.status(400).json({
                    success: false,
                    error: 'Please enter where the machine is available'
                });
            }
            machine.availableLocation = returnLocation;
        } else {
            machine.availableLocation = '';
        }
        machine.returnedAt = returnDate;
        machine.totalRentPaid = (machine.totalRentPaid || 0) + totalRent;
        machine.projectId = null;
        machine.assignedToContractor = null;
        machine.assignedAsRental = false;
        machine.assignedRentalPerDay = 0;
        machine.isRentPaused = false;
        machine.rentPausedAt = null;

        // Update History
        if (machine.assignmentHistory && machine.assignmentHistory.length > 0) {
            // We assume the last entry is the current one because we push on assignment
            const lastIdx = machine.assignmentHistory.length - 1;
            machine.assignmentHistory[lastIdx].returnedAt = returnDate;
            machine.assignmentHistory[lastIdx].returnStatus = 'returned';
            machine.assignmentHistory[lastIdx].totalRent = totalRent;
            machine.assignmentHistory[lastIdx].durationMinutes = machine.rentalType === 'perHour' ? diffValue : diffValue * 24 * 60;
        }

        const isIncome = machine.ownershipType === 'own' && contractorId;
        const isExpense = machine.ownershipType === 'rented';

        let expense = null;
        let transaction = null;

        if (isExpense) {
            // Create expense entry for rental
            expense = new Expense({
                projectId: targetProjectId,
                name: `Rental return: ${machine.name}${machine.plateNumber ? ' [' + machine.plateNumber + ']' : ''}`,
                amount: totalRent,
                category: 'machine_rental',
                remarks: `${diffDisplay} @ ₹${rate}/${machine.rentalType === 'perHour' ? 'hr' : 'day'}. Assigned: ${assignedDate.toLocaleDateString()} ${assignedDate.toLocaleTimeString()}, Returned: ${returnDate.toLocaleDateString()} ${returnDate.toLocaleTimeString()}`,
                addedBy: req.user.userId
            });
            await expense.save();

            // Update project expenses if projectId exists
            if (targetProjectId) {
                await Project.findByIdAndUpdate(
                    targetProjectId,
                    { $inc: { expenses: totalRent } }
                );
            }

            // Add the rent amount to the creditor's account
            if (machine.creditorId) {
                await Creditor.findByIdAndUpdate(machine.creditorId, {
                    $inc: { currentBalance: totalRent },
                    $push: {
                        transactions: {
                            type: 'credit',
                            amount: totalRent,
                            date: returnDate,
                            description: `Machine Rental: ${machine.name}${machine.plateNumber ? ' [' + machine.plateNumber + ']' : ''} for ${diffDisplay}`,
                            refId: expense._id,
                            refModel: 'Expense'
                        }
                    }
                });
            }
        } else if (isIncome) {
            // It's income (Capital). Create a Transaction to record the capital generated.
            const Transaction = require('../models/Transaction');
            transaction = new Transaction({
                amount: totalRent,
                type: 'credit',
                category: 'capital',
                description: `Machine Rent Income: ${machine.name} [${machine.plateNumber || ''}] from Contractor`,
                paymentMode: 'cash',
                date: returnDate,
                addedBy: req.user.userId
            });
            await transaction.save();
        }

        // Update contractor's pending amount if assigned
        // Machine rent is a DEDUCTION from contractor's total earnings
        if (contractorId) {
            const Contractor = require('../models/Contractor');
            await Contractor.findByIdAndUpdate(
                contractorId,
                { $inc: { pendingAmount: -totalRent } }
            );
        }

        // Save machine at the end so if transaction fails, machine is not marked returned
        await machine.save();

        res.json({
            success: true,
            message: 'Machine returned and record processed successfully',
            data: {
                machine,
                expense,
                transaction,
                rentalDetails: {
                    duration: diffDisplay,
                    rate,
                    totalRent
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

// Re-rent a returned machine (make it available for assignment again)
const reRentMachine = async (req, res, next) => {
    try {
        const { id } = req.params;
        const machine = await Machine.findById(id);

        if (!machine) {
            return res.status(404).json({ success: false, error: 'Machine not found' });
        }

        if (machine.status !== 'returned') {
            return res.status(400).json({ success: false, error: 'Only returned machines can be re-rented' });
        }

        // Reset machine for a fresh rental cycle
        machine.status = 'available';
        machine.assignedAt = null;
        machine.returnedAt = null;
        machine.rentedAt = new Date(); // Start fresh cycle from today
        machine.totalRentPaid = 0;
        machine.projectId = null;
        machine.assignedToContractor = null;
        machine.assignedAsRental = false;
        machine.assignedRentalPerDay = 0;
        machine.isRentPaused = false;
        machine.rentPausedAt = null;
        machine.rentPausedHistory = [];
        machine.availableLocation = req.body.availableLocation || 'Main Yard';

        machine.save();

        res.json({
            success: true,
            message: 'Machine re-activated successfully',
            data: machine
        });
    } catch (error) {
        console.error('Error re-renting machine:', error);
        next(error);
    }
};

const assignMachineQuantity = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { projectId, quantity } = req.body;
        const qtyToAssign = Number(quantity);

        if (!projectId || qtyToAssign <= 0) {
            return res.status(400).json({ success: false, error: 'Valid Project ID and Quantity > 0 are required' });
        }

        const machine = await Machine.findById(id);
        if (!machine) return res.status(404).json({ success: false, error: 'Machine not found' });

        if (machine.category !== 'lab' && machine.category !== 'equipment') {
            return res.status(400).json({ success: false, error: 'Only Lab Equipment and Equipment support quantity assignments' });
        }

        const totalAssigned = (machine.assignments || []).reduce((sum, a) => sum + a.quantity, 0);
        const availableQty = (Number(machine.quantity) || 1) - totalAssigned;

        if (qtyToAssign > availableQty) {
            return res.status(400).json({ success: false, error: `Cannot assign ${qtyToAssign}. Only ${availableQty} available.` });
        }

        // Check if project already has an assignment. If so, add to it.
        const existingAssignment = machine.assignments?.find(a => a.projectId?.toString() === projectId.toString());
        if (existingAssignment) {
            existingAssignment.quantity += qtyToAssign;
        } else {
            if (!machine.assignments) machine.assignments = [];
            machine.assignments.push({
                projectId,
                quantity: qtyToAssign,
                assignedAt: new Date()
            });
        }

        // Status logic
        machine.status = 'in-use';
        await machine.save();

        res.json({ success: true, message: 'Quantity assigned successfully', data: machine });
    } catch (error) {
        next(error);
    }
};

const unassignMachineQuantity = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { projectId, quantity } = req.body;
        const qtyToUnassign = Number(quantity);

        if (!projectId || qtyToUnassign <= 0) {
            return res.status(400).json({ success: false, error: 'Valid Project ID and Quantity > 0 are required' });
        }

        const machine = await Machine.findById(id);
        if (!machine) return res.status(404).json({ success: false, error: 'Machine not found' });

        if (!machine.assignments || machine.assignments.length === 0) {
            return res.status(400).json({ success: false, error: 'No assignments found' });
        }

        const existingAssignment = machine.assignments.find(a => a.projectId?.toString() === projectId.toString());
        if (!existingAssignment) {
            return res.status(400).json({ success: false, error: 'Not assigned to this project' });
        }

        if (qtyToUnassign > existingAssignment.quantity) {
            return res.status(400).json({ success: false, error: `Cannot unassign ${qtyToUnassign}. Only ${existingAssignment.quantity} assigned to this project.` });
        }

        existingAssignment.quantity -= qtyToUnassign;
        if (existingAssignment.quantity === 0) {
            machine.assignments = machine.assignments.filter(a => a.projectId?.toString() !== projectId.toString());
        }

        const remainingTotalAssigned = machine.assignments.reduce((sum, a) => sum + a.quantity, 0);
        if (remainingTotalAssigned === 0) {
            machine.status = 'available'; // Only available if EVERYTHING is unassigned.
        }

        await machine.save();

        res.json({ success: true, message: 'Quantity unassigned successfully', data: machine });
    } catch (error) {
        next(error);
    }
};

const getStocks = async (req, res, next) => {
    try {
        console.log(' Fetching stocks (ultra-fast)...');
        const startTime = Date.now();

        // Get stocks with population for addedBy
        const stocks = await Stock.find()
            .select('projectId vendorId materialName unit quantity unitPrice totalPrice remarks photos vehicleNumber addedBy createdAt')
            .populate('addedBy', 'name')
            .sort('-createdAt')
            .lean()
            .maxTimeMS(3000); // 3 second timeout

        const duration = Date.now() - startTime;
        console.log(` Ultra-fast stocks fetched in ${duration}ms (${stocks.length} items)`);

        res.json({
            success: true,
            data: stocks
        });
    } catch (error) {
        console.error(' Error fetching stocks:', error.message);

        // Return empty array on any error to prevent frontend issues
        res.json({
            success: true,
            data: [] // Return empty array instead of error
        });
    }
};

const createStock = async (req, res, next) => {
    try {
        const { projectId, vendorId, materialName, unit, quantity, unitPrice, remarks } = req.body;
        const userId = req.user.userId;

        const totalPrice = parseFloat(quantity) * parseFloat(unitPrice);

        let photoUrl = '';
        let photosUrls = [];

        // Handle single file (legacy)
        if (req.file) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            photoUrl = await uploadToCloudinary(req.file.buffer, 'stocks');
            photosUrls.push(photoUrl);
        }

        // Handle multiple files
        if (req.files && req.files.length > 0) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            for (const file of req.files) {
                const url = await uploadToCloudinary(file.buffer, 'stocks');
                photosUrls.push(url);
            }
        }

        // Use first photo as main photo if not set
        if (!photoUrl && photosUrls.length > 0) {
            photoUrl = photosUrls[0];
        }

        // Require at least one photo for stock entry
        if (!photoUrl && (!photosUrls || photosUrls.length === 0)) {
            return res.status(400).json({
                success: false,
                error: 'Please upload at least one image for stock entry'
            });
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
            photos: photosUrls,
            remarks,
            vehicleNumber: req.body.vehicleNumber || req.body.vehiclePlateNumber,
            addedBy: userId
        });

        await newStock.save();

        // Update vendor's totalSupplied and pendingAmount
        if (vendorId) {
            await Vendor.findByIdAndUpdate(
                vendorId,
                {
                    $inc: {
                        totalSupplied: totalPrice,
                        pendingAmount: totalPrice
                    }
                }
            );
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

const updateStock = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const stock = await Stock.findById(id);
        if (!stock) {
            return res.status(404).json({ success: false, error: 'Stock not found' });
        }

        // Handle new photos
        if (req.files && req.files.length > 0) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            const newPhotos = [];
            for (const file of req.files) {
                const url = await uploadToCloudinary(file.buffer, 'stocks');
                newPhotos.push(url);
            }
            if (!stock.photos) stock.photos = [];
            stock.photos.push(...newPhotos);
            updates.photos = stock.photos;

            // Update main photo if it was empty
            if (!stock.photo && newPhotos.length > 0) {
                updates.photo = newPhotos[0];
            }
        }

        // Recalculate total price if quantity or unitPrice changed
        if (updates.quantity || updates.unitPrice) {
            const quantity = updates.quantity ? parseFloat(updates.quantity) : stock.quantity;
            const unitPrice = updates.unitPrice ? parseFloat(updates.unitPrice) : stock.unitPrice;
            updates.totalPrice = quantity * unitPrice;
        }

        const updatedStock = await Stock.findByIdAndUpdate(
            id,
            updates,
            { new: true, runValidators: true }
        );

        res.json({
            success: true,
            message: 'Stock updated successfully',
            data: updatedStock
        });
    } catch (error) {
        next(error);
    }
};

const deleteStock = async (req, res, next) => {
    try {
        const { id } = req.params;

        const stock = await Stock.findByIdAndDelete(id);

        if (!stock) {
            return res.status(404).json({
                success: false,
                error: 'Stock not found'
            });
        }

        res.json({
            success: true,
            message: 'Stock deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};

const getTransfers = async (req, res, next) => {
    try {
        const transfers = await Transfer.find()
            .populate('fromProject', 'name')
            .populate('toProject', 'name')
            .populate('labourId', 'name')
            .populate('machineId', 'name')
            .sort('-createdAt')
            .limit(200)
            .lean();

        console.log(`🔍 [getTransfers] Fetched ${transfers.length} transfers from database`);
        console.log(`🔍 [getTransfers] Sample data:`, transfers.slice(0, 2));

        // Manual population for other types if needed?
        // Let's assume basic populate works for now. 
        res.json({ success: true, data: transfers });
    } catch (error) {
        next(error);
    }
};

const createTransfer = async (req, res, next) => {
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
            status: 'approved'
        };

        // Handle specific types and ID assignment
        if (type === 'labour') {
            if (!itemId) return res.status(400).json({ success: false, error: 'Labour is required' });
            transferData.labourId = itemId;
        } else if (type === 'machine' || type === 'lab-equipment' || type === 'equipment') {
            if (!itemId) return res.status(400).json({ success: false, error: 'Item is required' });
            transferData.machineId = itemId;
            // Note: Transfer model might need specific fields for lab/equipment if they are not "Machine"
            // But usually we just store ID in machineId or a generic itemId. 
            // Let's assume machineId is used for all asset IDs for now or add more fields to Transfer model if strictly typed.
            // PROCEED with machineId for now.
        } else if (type === 'stock' || type === 'consumable-goods') {
            if (!itemId) return res.status(400).json({ success: false, error: 'Item is required' });
            transferData.materialName = itemId; // Fallback

            if (type === 'consumable-goods') {
                const item = await ConsumableGoods.findById(itemId);
                if (item) transferData.materialName = item.name;
            } else if (type === 'stock') {
                const sourceStock = await Stock.findById(itemId);
                if (sourceStock) {
                    transferData.materialName = sourceStock.materialName;
                }
            }
        }

        const transfer = new Transfer(transferData);
        await transfer.save();

        // EXECUTE TRANSFER (Move Items)
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
            const sourceStock = await Stock.findById(itemId);

            if (sourceStock) {
                sourceStock.quantity = Math.max(0, sourceStock.quantity - (parseFloat(quantity) || 0));
                await sourceStock.save();

                // Add to destination
                const stockQuantity = parseFloat(quantity) || 0;
                let destStock = await Stock.findOne({
                    projectId: toProject,
                    materialName: sourceStock.materialName,
                    vendorId: sourceStock.vendorId, // might vary
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
            const sourceItem = await ConsumableGoods.findById(itemId);
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
            message: 'Transfer created successfully',
            data: transfer
        });
    } catch (error) {
        next(error);
    }
};

const getAccounts = async (req, res, next) => {
    try {
        const { startDate, endDate, managerId } = req.query;

        // Build date filter
        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);

        // Fetch all transaction sources
        const [
            manualTransactions,
            expenses,
            vendorPayments,
            contractorPayments,
            labourPayments,
            creditorPayments
        ] = await Promise.all([
            Transaction.find(dateFilter.$gte || dateFilter.$lte ? { date: dateFilter } : {})
                .populate('addedBy', 'name role')
                .populate('projectId', 'name')
                .populate('creditorId', 'name')
                .sort('-date')
                .limit(100)
                .lean(),
            Expense.find(dateFilter.$gte || dateFilter.$lte ? { createdAt: dateFilter } : {})
                .populate('addedBy', 'name role')
                .populate('projectId', 'name')
                .sort('-createdAt')
                .limit(100)
                .lean(),
            VendorPayment.find(dateFilter.$gte || dateFilter.$lte ? { date: dateFilter } : {})
                .populate('vendorId', 'name')
                .populate('bankId', 'bankName')
                .populate('creditorId', 'name')
                .populate('recordedBy', 'name role')
                .sort('-date')
                .limit(100)
                .lean(),
            ContractorPayment.find(dateFilter.$gte || dateFilter.$lte ? { date: dateFilter } : {})
                .populate('bankId', 'bankName')
                .populate('creditorId', 'name')
                .populate('paidBy', 'name role')
                .sort('-date')
                .limit(100)
                .lean(),
            LabourPayment.find(dateFilter.$gte || dateFilter.$lte ? { date: dateFilter } : {})
                .populate('labourId', 'name')
                .populate('userId', 'name role')
                .sort('-createdAt')
                .limit(100)
                .lean(),
            CreditorPayment.find(dateFilter.$gte || dateFilter.$lte ? { date: dateFilter } : {})
                .populate('creditorId', 'name')
                .populate('bankId', 'bankName')
                .populate('recordedBy', 'name role')
                .sort('-date')
                .limit(100)
                .lean()
        ]);

        console.log(`🔍 [getAccounts] Fetched data:`);
        console.log(`  - Transactions: ${manualTransactions.length}`);
        console.log(`  - Expenses: ${expenses.length}`);
        console.log(`  - VendorPayments: ${vendorPayments.length}`);
        console.log(`  - ContractorPayments: ${contractorPayments.length}`);
        console.log(`  - LabourPayments: ${labourPayments.length}`);
        console.log(`  - CreditorPayments: ${creditorPayments.length}`);


        // Normalize all transactions to a common format
        const allTransactions = [];

        // Helper to normalize payment mode
        const normalizeMode = (mode) => (mode || 'cash').toLowerCase();

        // Helper to ensure valid date
        const ensureDate = (d, fallback) => {
            if (!d) return new Date(fallback || Date.now());
            const dateObj = new Date(d);
            return isNaN(dateObj.getTime()) ? new Date(fallback || Date.now()) : dateObj;
        };

        // Add manual transactions
        manualTransactions.forEach(t => {
            allTransactions.push({
                _id: t._id,
                refModel: 'Transaction',
                date: ensureDate(t.date),
                description: t.description,
                amount: t.amount,
                type: t.type,
                category: t.category,
                paymentMode: normalizeMode(t.paymentMode),
                source: (t.category === 'capital' && t.creditorId) ? t.creditorId.name : (t.addedBy ? `${t.addedBy.name} (${t.addedBy.role})` : 'System'),
                receivedFrom: t.category === 'third_party_funds' ? t.description.split(' - ')[0].replace('Received from: ', '') : null,
                projectId: t.projectId,
                relatedId: t.relatedId,
                addedBy: t.addedBy,
                creditorId: t.creditorId,
                recordedBy: t.addedBy ? `${t.addedBy.name} (${t.addedBy.role})` : 'System'
            });
            // Append Project Name to description if exists
            const lastIdx = allTransactions.length - 1;
            if (t.projectId && t.projectId.name) {
                allTransactions[lastIdx].description = `${allTransactions[lastIdx].description} - ${t.projectId.name}`;
            }
        });

        // Add expenses as debit transactions
        expenses.forEach(e => {
            // Filter by manager if specified
            if (managerId && e.addedBy?._id?.toString() !== managerId) return;

            allTransactions.push({
                _id: e._id,
                refModel: 'Expense',
                date: ensureDate(e.createdAt),
                description: `${e.name}${e.projectId ? ` - ${e.projectId.name}` : ''}`,
                amount: e.amount || 0,
                type: 'debit',
                category: 'expense',
                paymentMode: normalizeMode(e.paymentMode),
                source: 'Expense',
                receiptUrl: e.receipt,
                recordedBy: e.addedBy ? `${e.addedBy.name} (${e.addedBy.role})` : 'System'
            });
        });

        // Add vendor payments as debit transactions
        vendorPayments.forEach(vp => {
            allTransactions.push({
                _id: vp._id,
                refModel: 'VendorPayment',
                date: ensureDate(vp.date, vp.createdAt),
                description: `Payment to ${vp.vendorId?.name || 'Vendor'}${vp.remarks ? ` - ${vp.remarks}` : ''}`,
                amount: vp.amount || 0,
                type: 'debit',
                category: 'vendor_payment',
                paymentMode: normalizeMode(vp.paymentMode),
                source: vp.bankId ? `Bank: ${vp.bankId.bankName}` : (vp.creditorId ? `Creditor: ${vp.creditorId.name}` : (vp.paymentMode === 'cash' ? 'Main Cash' : vp.paymentMode)),
                receiptUrl: vp.receiptUrl,
                recordedBy: vp.recordedBy ? `${vp.recordedBy.name} (${vp.recordedBy.role})` : 'System'
            });
        });

        // Add contractor payments as debit transactions
        contractorPayments.forEach(cp => {
            allTransactions.push({
                _id: cp._id,
                refModel: 'ContractorPayment',
                date: ensureDate(cp.date, cp.createdAt),
                description: `${cp.advance > 0 || cp.isAdvance ? 'Advance to' : 'Payment to'} ${cp.contractorName}${cp.remark ? ` - ${cp.remark}` : ''}`,
                amount: cp.amount || cp.advance || 0,
                type: 'debit',
                category: 'contractor_payment',
                paymentMode: normalizeMode(cp.paymentMode),
                source: cp.bankId ? `Bank: ${cp.bankId.bankName}` : (cp.creditorId ? `Creditor: ${cp.creditorId.name}` : (cp.paymentMode === 'cash' ? 'Main Cash' : cp.paymentMode)),
                receiptUrl: cp.receiptUrl,
                recordedBy: cp.paidBy ? `${cp.paidBy.name} (${cp.paidBy.role})` : 'System'
            });
        });

        // Add creditor payments as debit transactions
        creditorPayments.forEach(cp => {
            allTransactions.push({
                _id: cp._id,
                refModel: 'CreditorPayment',
                date: ensureDate(cp.date, cp.createdAt),
                description: `Payment to Creditor: ${cp.creditorId?.name || 'Unknown'}${cp.remarks ? ` - ${cp.remarks}` : ''}`,
                amount: cp.amount || 0,
                type: 'debit',
                category: 'creditor_payment',
                paymentMode: normalizeMode(cp.paymentMode),
                source: cp.bankId ? `Bank: ${cp.bankId.bankName}` : (cp.paymentMode === 'cash' ? 'Main Cash' : cp.paymentMode),
                recordedBy: cp.recordedBy ? `${cp.recordedBy.name} (${cp.recordedBy.role})` : 'System'
            });
        });

        // Add labour payments as debit transactions
        labourPayments.forEach(lp => {
            allTransactions.push({
                _id: lp._id,
                refModel: 'LabourPayment',
                date: ensureDate(lp.date, lp.createdAt),
                description: `Payment to ${lp.labourId?.name || 'Labour'}${lp.remarks ? ` - ${lp.remarks}` : ''}`,
                amount: lp.amount || 0,
                type: 'debit',
                category: 'expense',
                paymentMode: normalizeMode(lp.paymentMode),
                source: 'Labour Payment',
                recordedBy: lp.userId ? `${lp.userId.name} (${lp.userId.role})` : 'System'
            });
        });

        // Sort all transactions by date (newest first)
        allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Calculate totals
        // Capital Credits (money added)
        const capitalCredits = manualTransactions
            .filter(t => t.category === 'capital' && t.type === 'credit')
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        // Total Debits (operational spending only — exclude creditor payments which are liability management)
        const totalDebits = allTransactions
            .filter(t => t.type === 'debit' && t.category !== 'creditor_payment')
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        // Net Capital = Capital Credits - Operational Debits (creditor payments don't affect capital)
        const capital = capitalCredits - totalDebits;

        // Total Expenses (for display purposes)
        const totalExpenses = allTransactions
            .filter(t => t.type === 'debit' && t.category !== 'creditor_payment')
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        const totalBankTransactions = allTransactions
            .filter(t => ['bank', 'online', 'upi', 'check'].includes(t.paymentMode))
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        const totalCashTransactions = allTransactions
            .filter(t => t.paymentMode === 'cash')
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        res.json({
            success: true,
            data: {
                capital,
                totalExpenses,
                totalBankTransactions,
                totalCashTransactions,
                transactions: allTransactions
            }
        });
    } catch (error) {
        console.error('Error fetching accounts:', error);
        next(error);
    }
};

const addCapital = async (req, res, next) => {
    try {
        const { amount, description, paymentMode, date, creditorId, bankId, projectId, contractorId } = req.body;

        const transaction = new Transaction({
            amount: parseFloat(amount),
            type: 'credit',
            category: 'capital',
            description: description || 'Capital addition',
            paymentMode: paymentMode || 'bank',
            date: date || new Date(),
            addedBy: req.user.userId,
            bankId: bankId || null,
            projectId: projectId || null,
            creditorId: creditorId || null,
            contractorId: contractorId || null
        });

        await transaction.save();

        // Update Bank Balance if bankId is present
        if (bankId) {
            const BankDetail = require('../models/BankDetail');
            await BankDetail.findByIdAndUpdate(bankId, {
                $inc: { currentBalance: parseFloat(amount) },
                $push: {
                    transactions: {
                        type: 'credit',
                        amount: parseFloat(amount),
                        date: date || new Date(),
                        description: description || 'Capital addition',
                        refId: transaction._id
                    }
                }
            });
        }

        // Update Creditor Balance if creditorId is present
        if (creditorId) {
            const Creditor = require('../models/Creditor');
            await Creditor.findByIdAndUpdate(creditorId, {
                $inc: { currentBalance: -parseFloat(amount) }, // Wallet logic: Giving money = Minus
                $push: {
                    transactions: {
                        type: 'debit', // Wallet gives money = Debit
                        amount: parseFloat(amount),
                        date: date || new Date(),
                        description: description || 'Capital Provided',
                        refId: transaction._id,
                        refModel: 'Transaction'
                    }
                }
            });
        }

        // Update Contractor Balance if contractorId is present
        if (contractorId) {
            const Contractor = require('../models/Contractor');
            await Contractor.findByIdAndUpdate(contractorId, {
                $inc: { capitalProvided: parseFloat(amount) }
            });
        }

        res.json({
            success: true,
            message: 'Capital added successfully',
            data: transaction
        });
    } catch (error) {
        console.error('Error adding capital:', error);
        next(error);
    }
};

const addTransaction = async (req, res, next) => {
    try {
        const { amount, description, type, category, paymentMode, date } = req.body;

        const transaction = new Transaction({
            amount: parseFloat(amount),
            type: type || 'debit',
            category: category || 'other',
            description: description || 'Transaction',
            paymentMode: paymentMode || 'cash',
            date: date || new Date(),
            addedBy: req.user.userId,
            bankId: req.body.bankId || null,
            creditorId: req.body.creditorId || null,
            projectId: req.body.projectId || null
        });

        await transaction.save();

        // Update Bank Balance if bankId is present
        if (req.body.bankId) {
            const isCredit = (type || 'debit') === 'credit'; // Credit = Money In (Deposit), Debit = Money Out
            const balanceChange = isCredit ? parseFloat(amount) : -parseFloat(amount);

            await BankDetail.findByIdAndUpdate(req.body.bankId, {
                $inc: { currentBalance: balanceChange },
                $push: {
                    transactions: {
                        type: isCredit ? 'credit' : 'debit',
                        amount: parseFloat(amount),
                        date: date || new Date(),
                        description: description || 'Transaction',
                        refId: transaction._id,
                        refModel: 'Transaction'
                    }
                }
            });
        }

        // Update Creditor if creditorId is present
        if (req.body.creditorId) {
            const isCredit = (type || 'debit') === 'credit';
            // Credit means Money IN (Deposit) -> We took money from Creditor -> Liability INCREASES (+)
            // Debit means Money OUT (Withdrawal) -> We paid Creditor -> Liability DECREASES (-)
            const balanceChange = isCredit ? parseFloat(amount) : -parseFloat(amount);

            await Creditor.findByIdAndUpdate(req.body.creditorId, {
                $inc: { currentBalance: balanceChange },
                $push: {
                    transactions: {
                        type: isCredit ? 'credit' : 'debit',
                        amount: parseFloat(amount),
                        date: date || new Date(),
                        description: description || 'Account Transaction',
                        refId: transaction._id,
                        refModel: 'Transaction'
                    }
                }
            });
        }

        res.json({
            success: true,
            message: 'Transaction added successfully',
            data: transaction
        });
    } catch (error) {
        console.error('Error adding transaction:', error);
        next(error);
    }
};

const updateTransactionMeta = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { description, date } = req.body;
        
        const transaction = await Transaction.findById(id);
        if (!transaction) return res.status(404).json({ success: false, error: 'Transaction not found' });
        
        transaction.description = description || transaction.description;
        transaction.date = date || transaction.date;
        await transaction.save();

        // Update in Creditor if present
        if (transaction.creditorId) {
            await Creditor.updateOne(
                { _id: transaction.creditorId, 'transactions.refId': transaction._id },
                { $set: { 'transactions.$.description': transaction.description, 'transactions.$.date': transaction.date } }
            );
        }

        // Update in BankDetail if present
        if (transaction.bankId) {
            await BankDetail.updateOne(
                { _id: transaction.bankId, 'transactions.refId': transaction._id },
                { $set: { 'transactions.$.description': transaction.description, 'transactions.$.date': transaction.date } }
            );
        }

        res.json({ success: true, message: 'Transaction details updated' });
    } catch (error) {
        next(error);
    }
};

// Allocate funds to site manager wallet
const allocateFunds = async (req, res, next) => {
    try {
        const { managerId, amount, description, paymentMode } = req.body;

        // Validate manager exists
        const manager = await User.findById(managerId);
        if (!manager || manager.role !== 'sitemanager') {
            return res.status(404).json({
                success: false,
                error: 'Site manager not found'
            });
        }

        // Update manager's wallet balance
        manager.walletBalance = (manager.walletBalance || 0) + parseFloat(amount);
        await manager.save();

        // Create transaction record
        const transaction = new Transaction({
            category: 'wallet_allocation',
            description: description || `Wallet allocation to ${manager.name}`,
            amount: parseFloat(amount),
            type: 'debit',
            paymentMode: paymentMode || 'bank',
            date: new Date(),
            bankId: req.body.bankId || null,
            relatedId: manager._id,
            onModel: 'User'
        });

        await transaction.save();

        // If bankId is provided, record transaction in bank
        if (req.body.bankId) {
            await BankDetail.findByIdAndUpdate(req.body.bankId, {
                $inc: { currentBalance: -parseFloat(amount) },
                $push: {
                    transactions: {
                        type: 'debit',
                        amount: parseFloat(amount),
                        date: new Date(),
                        description: description || `Wallet allocation to ${manager.name}`,
                        refId: transaction._id,
                        refModel: 'Transaction'
                    }
                }
            });
        }

        res.json({
            success: true,
            message: 'Funds allocated successfully',
            data: transaction
        });
    } catch (error) {
        next(error);
    }
};

const generateReport = async (req, res, next) => {
    try {
        const { type, startDate, endDate, projectId, userId } = req.query;
        let data;

        const createdAtFilter = {};
        if (startDate || endDate) {
            createdAtFilter.createdAt = {};
            if (startDate) createdAtFilter.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                createdAtFilter.createdAt.$lte = end;
            }
        }
        if (projectId) {
            createdAtFilter.projectId = projectId;
        }
        if (userId) {
            createdAtFilter.addedBy = userId;
        }

        const dateFieldFilter = {};
        if (startDate || endDate) {
            dateFieldFilter.date = {};
            if (startDate) dateFieldFilter.date.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                dateFieldFilter.date.$lte = end;
            }
        }
        if (projectId) {
            dateFieldFilter.projectId = projectId;
        }
        // Specific user fields mapped per logic below, but we can add recordedBy/userId etc
        if (userId) {
            // Because different models have different user fields, we might need custom logic, 
            // but setting a general filter for now.
        }

        const attendanceDateFilter = {};
        if (startDate || endDate) {
            attendanceDateFilter.date = {};
            if (startDate) attendanceDateFilter.date.$gte = startDate;
            if (endDate) attendanceDateFilter.date.$lte = endDate;
        }
        if (projectId) {
            attendanceDateFilter.projectId = projectId;
        }

        const filter = { ...createdAtFilter };

        switch (type) {
            case 'expenses': {
                const VendorPayment = require('../models/VendorPayment');
                const ContractorPayment = require('../models/ContractorPayment');
                const LabourPayment = require('../models/LabourPayment');

                const CreditorPayment = require('../models/CreditorPayment');
                const Transaction = require('../models/Transaction');

                const [genExps, venExps, conExps, labExps, creditorExps, bankTransfers] = await Promise.all([
                    Expense.find(filter).populate('projectId', 'name').populate('addedBy', 'name').lean(),
                    VendorPayment.find(dateFieldFilter).populate('vendorId', 'name').populate('recordedBy', 'name').lean(),
                    ContractorPayment.find(dateFieldFilter).populate('contractorId', 'name').populate('paidBy', 'name').populate('projectId', 'name').lean(),
                    LabourPayment.find(dateFieldFilter).populate('labourId', 'name').populate('userId', 'name').lean(),
                    CreditorPayment.find(dateFieldFilter).populate('creditorId', 'name').populate('recordedBy', 'name').lean(),
                    // For bank to bank, we look for debits that are not linked to standard entities
                    Transaction.find({ 
                        ...dateFieldFilter, 
                        type: 'debit',
                        category: { $in: ['manager_transfer', 'other', 'wallet_allocation', 'maintenance', 'third_party_funds'] }
                    }).populate('addedBy', 'name').populate('projectId', 'name').lean()
                ]);

                const allExpenses = [
                    ...genExps.map(e => ({ ...e, reportType: 'General Expense' })),
                    ...venExps.map(v => ({
                        ...v,
                        projectId: v.projectId || null,
                        amount: v.amount,
                        name: v.vendorId?.name || 'Unknown',
                        category: 'vendor_payment',
                        addedBy: v.recordedBy,
                        reportType: 'Vendor Payment',
                        createdAt: v.date || v.createdAt
                    })),
                    ...conExps.map(c => ({
                        ...c,
                        projectId: c.projectId || null,
                        amount: c.amount,
                        name: c.contractorName || c.contractorId?.name || 'Unknown',
                        category: 'contractor_payment',
                        addedBy: c.paidBy,
                        reportType: 'Contractor Payment',
                        createdAt: c.date || c.createdAt
                    })),
                    ...labExps.map(l => ({
                        ...l,
                        projectId: l.projectId || null,
                        amount: l.amount,
                        name: l.labourId?.name || 'Unknown',
                        category: 'labour_payment',
                        addedBy: l.userId,
                        reportType: 'Labour Payment',
                        createdAt: l.date || l.createdAt
                    })),
                    ...creditorExps.map(c => ({
                        ...c,
                        projectId: null,
                        amount: c.amount,
                        name: c.creditorId?.name || 'Unknown',
                        category: 'creditor_payment',
                        addedBy: c.recordedBy,
                        reportType: 'Creditor Payment',
                        createdAt: c.date || c.createdAt
                    })),
                    ...bankTransfers.map(b => ({
                        ...b,
                        projectId: b.projectId || null,
                        amount: b.amount,
                        name: b.description || 'Bank / Internal Transfer',
                        category: b.category,
                        paymentMode: b.paymentMode || 'bank',
                        addedBy: b.addedBy,
                        reportType: 'Internal Expense',
                        createdAt: b.date || b.createdAt
                    }))
                ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                data = allExpenses;
                break;
            }

            case 'attendance':
                data = await Attendance.find(attendanceDateFilter)
                    .populate('userId', 'name email role')
                    .populate('projectId', 'name location')
                    .sort('-date')
                    .lean();
                data = data.map(a => ({
                    date: a.date,
                    time: a.time ? new Date(a.time).toLocaleString('en-IN') : 'N/A',
                    siteManager: a.userId?.name || 'Unknown',
                    email: a.userId?.email || '',
                    project: a.projectId?.name || 'N/A',
                    location: a.projectId?.location || '',
                    remarks: a.remarks || '',
                    hasSelfie: a.photo ? 'Yes' : 'No'
                }));
                break;

            case 'stock': {
                const StockOut = require('../models/StockOut');
                const stockFilter = { ...filter };
                if (userId) stockFilter.addedBy = userId;
                
                const stockOutFilter = { ...dateFieldFilter };
                if (userId) stockOutFilter.recordedBy = userId;

                const [stocks, stockOuts] = await Promise.all([
                    Stock.find(stockFilter).populate('projectId', 'name').populate('vendorId', 'name').populate('addedBy', 'name').lean(),
                    StockOut.find(stockOutFilter).populate('projectId', 'name').populate('recordedBy', 'name').lean()
                ]);

                data = [
                    ...stocks.map(s => ({
                        ...s,
                        type: 'Stock In',
                        createdAt: s.date || s.createdAt
                    })),
                    ...stockOuts.map(so => ({
                        ...so,
                        type: 'Stock Out',
                        materialName: so.materialName,
                        quantity: so.quantity,
                        unit: so.unit || '-',
                        unitPrice: null,
                        totalPrice: null,
                        vehicleNumber: '-',
                        vendorId: null,
                        addedBy: so.recordedBy,
                        remarks: so.remarks || so.purpose,
                        createdAt: so.date || so.createdAt
                    }))
                ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                break;
            }

            case 'machines':
                data = await Machine.find(filter)
                    .populate('projectId', 'name')
                    .populate('assignedToContractor', 'name')
                    .populate('creditorId', 'name')
                    .sort({ createdAt: -1 })
                    .lean();
                break;

            case 'contractors': {
                const ContractorPayment = require('../models/ContractorPayment');
                const contractors = await Contractor.find()
                    .populate('assignedProjects', 'name location')
                    .lean();
                const payments = await ContractorPayment.find(dateFieldFilter).lean();

                data = contractors.map(c => {
                    const cPayments = payments.filter(p =>
                        String(p.contractorId) === String(c._id)
                    );
                    const paidInPeriod = cPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
                    const machineRentInPeriod = cPayments.reduce((sum, p) => sum + (p.machineRent || 0), 0);
                    const currentProjects = (c.assignedProjects || [])
                        .map(p => (typeof p === 'object' ? p.name : p))
                        .filter(Boolean)
                        .join(', ');

                    return {
                        name: c.name,
                        mobile: c.mobile,
                        status: c.status,
                        currentProjects: currentProjects || 'None',
                        pendingAmount: c.pendingAmount || 0,
                        totalPaidAllTime: c.totalPaid || 0,
                        paidInPeriod,
                        machineRentInPeriod,
                        paymentsInPeriod: cPayments.length,
                        distance: `${c.distanceValue || 0} ${c.distanceUnit || 'km'}`,
                        expensePerUnit: c.expensePerUnit || 0,
                        advancePayment: c.advancePayment || 0,
                        registeredOn: c.createdAt
                    };
                });
                break;
            }

            case 'vendors': {
                const VendorPayment = require('../models/VendorPayment');
                const vendors = await Vendor.find().lean();
                const payments = await VendorPayment.find(dateFieldFilter).lean();
                const stocks = await Stock.find(filter)
                    .populate('projectId', 'name')
                    .lean();

                data = vendors.map(v => {
                    const vPayments = payments.filter(p =>
                        String(p.vendorId) === String(v._id)
                    );
                    const vStocks = stocks.filter(s =>
                        String(s.vendorId) === String(v._id)
                    );
                    const paidInPeriod = vPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
                    const stockValueInPeriod = vStocks.reduce((sum, s) => sum + (s.totalPrice || 0), 0);

                    return {
                        vendorId: v.vendorId || v._id,
                        name: v.name,
                        contact: v.contact,
                        email: v.email || '',
                        pendingAmount: v.pendingAmount || 0,
                        totalSuppliedAllTime: v.totalSupplied || 0,
                        paidInPeriod,
                        paymentsInPeriod: vPayments.length,
                        stockEntriesInPeriod: vStocks.length,
                        stockValueInPeriod,
                        materialsSupplied: (v.materialsSupplied || []).join(', ') || 'N/A',
                        registeredOn: v.createdAt
                    };
                });
                break;
            }

            case 'siteManagers': {
                const managers = await User.find({ role: 'sitemanager' })
                    .select('-password')
                    .populate('assignedSites', 'name location')
                    .lean();
                const attendanceLogs = await Attendance.find(attendanceDateFilter).lean();

                data = managers.map(m => {
                    const myAttendance = attendanceLogs.filter(a =>
                        String(a.userId) === String(m._id)
                    );
                    const sorted = [...myAttendance].sort((a, b) =>
                        new Date(b.date) - new Date(a.date)
                    );
                    const assignedSites = (m.assignedSites || [])
                        .map(p => (typeof p === 'object' ? p.name : p))
                        .filter(Boolean)
                        .join(', ');

                    return {
                        name: m.name,
                        email: m.email,
                        phone: m.phone || 'N/A',
                        status: m.active ? 'Active' : 'Inactive',
                        assignedSites: assignedSites || 'None',
                        walletBalance: m.walletBalance || 0,
                        salary: m.salary || 0,
                        attendanceInPeriod: myAttendance.length,
                        lastAttendanceDate: sorted[0]?.date || 'N/A',
                        dateOfJoining: m.dateOfJoining
                            ? new Date(m.dateOfJoining).toLocaleDateString('en-IN')
                            : 'N/A'
                    };
                });
                break;
            }

            case 'pl': {
                // Calculate P&L metrics
                const expenses = await Expense.find(filter);
                const Project = require('../models/Project');
                const projects = await Project.find(filter);

                const totalRevenue = projects.reduce((sum, p) => sum + (p.budget || 0), 0);
                const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

                const VendorPayment = require('../models/VendorPayment');
                const ContractorPayment = require('../models/ContractorPayment');
                const LabourPayment = require('../models/LabourPayment');
                const Transaction = require('../models/Transaction');

                const [vendorP, contractorP, labourP, capitalP] = await Promise.all([
                    VendorPayment.find(dateFieldFilter),
                    ContractorPayment.find(dateFieldFilter),
                    LabourPayment.find(dateFieldFilter),
                    Transaction.find({ ...dateFieldFilter, category: 'capital', type: 'credit' })
                ]);

                const vpTotal = vendorP.reduce((sum, v) => sum + (v.amount || 0), 0);
                const cpTotal = contractorP.reduce((sum, c) => sum + (c.amount || 0), 0);
                const lpTotal = labourP.reduce((sum, l) => sum + (l.amount || 0), 0);
                const capTotal = capitalP.reduce((sum, c) => sum + (c.amount || 0), 0);

                const trueRevenue = totalRevenue + capTotal;
                const trueExpenses = totalExpenses + vpTotal + cpTotal + lpTotal;

                data = [
                    { type: 'Revenue', description: 'Total Project Budgets', amount: totalRevenue },
                    { type: 'Revenue', description: 'Capital Injections', amount: capTotal },
                    ...projects.map(p => ({
                        type: 'Revenue',
                        description: `Project Budget: ${p.name}`,
                        amount: p.budget || 0
                    })),
                    { type: 'Expenses', description: 'General Expenses', amount: totalExpenses },
                    { type: 'Expenses', description: 'Vendor Payments', amount: vpTotal },
                    { type: 'Expenses', description: 'Contractor Payments', amount: cpTotal },
                    { type: 'Expenses', description: 'Labour Wages', amount: lpTotal },
                    { type: 'Profit', description: 'Net Balance', amount: trueRevenue - trueExpenses }
                ];
                break;
            }

            case 'full':
            default: {
                const VendorPayment = require('../models/VendorPayment');
                const ContractorPayment = require('../models/ContractorPayment');
                const LabourPayment = require('../models/LabourPayment');

                const [fullGenExps, fullVenExps, fullConExps, fullLabExps, fullProjs, fullUsers, fullStocks, fullMachines, fullContractors] = await Promise.all([
                    Expense.find(filter).populate('projectId', 'name').populate('addedBy', 'name').lean(),
                    VendorPayment.find(dateFieldFilter).populate('vendorId', 'name').populate('recordedBy', 'name').lean(),
                    ContractorPayment.find(dateFieldFilter).populate('contractorId', 'name').populate('paidBy', 'name').lean(),
                    LabourPayment.find(dateFieldFilter).populate('labourId', 'name').populate('userId', 'name').lean(),
                    Project.find().lean(),
                    User.find().select('name email role').lean(),
                    Stock.find(filter).populate('projectId', 'name').populate('vendorId', 'name').lean(),
                    Machine.find({ ...filter, category: 'big' }).populate('projectId', 'name').populate('assignedToContractor', 'name').lean(),
                    Contractor.find().lean()
                ]);

                const fullAllExpenses = [
                    ...fullGenExps.map(e => ({ ...e, reportType: 'General Expense' })),
                    ...fullVenExps.map(v => ({
                        ...v,
                        amount: v.amount,
                        name: `Vendor Payment: ${v.vendorId?.name || 'Unknown'}`,
                        category: 'vendor_payment',
                        reportType: 'Vendor Payment'
                    })),
                    ...fullConExps.map(c => ({
                        ...c,
                        amount: c.amount,
                        name: `Contractor Payment: ${c.contractorName || c.contractorId?.name || 'Unknown'}`,
                        category: 'contractor_payment',
                        reportType: 'Contractor Payment'
                    })),
                    ...fullLabExps.map(l => ({
                        ...l,
                        amount: l.amount,
                        name: `Labour Payment: ${l.labourId?.name || 'Unknown'}`,
                        category: 'labour_payment',
                        reportType: 'Labour Payment'
                    }))
                ];

                data = {
                    summary: {
                        totalProjects: fullProjs.length,
                        totalExpenses: fullAllExpenses.reduce((sum, exp) => sum + (exp.amount || 0), 0),
                        totalUsers: fullUsers.length,
                        totalStocks: fullStocks.length,
                        totalMachines: fullMachines.length,
                        totalContractors: fullContractors.length
                    },
                    expenses: fullAllExpenses,
                    projects: fullProjs,
                    users: fullUsers,
                    stocks: fullStocks,
                    machines: fullMachines,
                    contractors: fullContractors
                };
                break;
            }
        }

        res.json({
            success: true,
            data
        });
    } catch (error) {
        next(error);
    }
};

const getAttendance = async (req, res, next) => {
    try {
        const attendance = await Attendance.find()
            .populate('userId', 'name email role')
            .populate('projectId', 'name location')
            .sort('-date');

        res.json({ success: true, data: attendance });
    } catch (error) {
        next(error);
    }
};

const getLabourAttendance = async (req, res, next) => {
    try {
        const attendance = await LabourAttendance.find()
            .populate('labourId', 'name designation')
            .populate('projectId', 'name location')
            .populate('markedBy', 'name')
            .sort('-createdAt');

        res.json({ success: true, data: attendance });
    } catch (error) {
        next(error);
    }
};


const getLabourPayments = async (req, res, next) => {
    try {
        const payments = await LabourPayment.find()
            .populate('labourId', 'name designation phone')
            .populate('userId', 'name')
            .sort('-createdAt')
            .limit(200);
        res.json({ success: true, data: payments });
    } catch (error) {
        next(error);
    }
};

// Helper to create notification (Internal Use)
const createNotification = async ({ recipientId, title, message, type = 'info', link, relatedId, relatedModel }) => {
    try {
        await Notification.create({
            recipient: recipientId,
            title,
            message,
            type,
            link,
            relatedId,
            relatedModel
        });
        console.log(`🔔 Notification sent to ${recipientId}: ${title}`);
    } catch (error) {
        console.error('❌ Error creating notification:', error);
    }
};

const getNotifications = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const notifications = await Notification.find({
            $or: [
                { recipient: userId }, // Received
                { relatedId: userId, relatedModel: 'User' } // Sent by me
            ]
        })
            .sort('-createdAt')
            .limit(50)
            .populate('relatedId', 'name role'); // optional: see who sent it if relatedModel is User

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

// API to send notification (e.g. manually from admin or system)
const sendNotification = async (req, res, next) => {
    try {
        const { recipientId, title, message, type, link } = req.body;
        const senderId = req.user.userId;

        if (recipientId) {
            // Send to specific user
            await createNotification({
                recipientId,
                title,
                message,
                type,
                link,
                relatedId: senderId, // Tracking who sent it
                relatedModel: 'User'
            });
        } else {
            // Broadcast to all Site Managers
            const siteManagers = await User.find({ role: 'sitemanager', active: true });
            const notifications = siteManagers.map(sm => ({
                recipient: sm._id,
                title,
                message,
                type,
                link,
                relatedId: senderId,
                relatedModel: 'User'
            }));

            if (notifications.length > 0) {
                await Notification.insertMany(notifications);
            }
        }

        res.json({ success: true, message: 'Notification sent successfully' });
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

module.exports = {
    getDashboard,
    getProjects,
    getProjectDetail,
    createProject,
    updateProject,
    deleteProject,
    getMachines,
    createMachine,
    updateMachine,
    deleteMachine,
    getStocks,
    createStock,
    updateStock,
    deleteStock,
    getVendors,
    createVendor,
    updateVendor,
    deleteVendor,
    recordVendorPayment,
    getExpenses,
    createExpense,
    deleteExpense,
    getUsers,
    createUser,
    updateUser,
    deleteUser,
    getContractors,
    createContractor,
    updateContractor,
    deleteContractor,
    getContractorPayments,
    createContractorPayment,
    getTransfers,
    createTransfer,
    getAccounts,
    addCapital,
    addTransaction,
    updateTransactionMeta,
    generateReport,
    getAttendance,
    getLabourAttendance,
    getNotifications,
    sendNotification,
    markNotificationRead,
    getLabours
};

// ============ LAB EQUIPMENT ============

const addLabEquipment = async (req, res, next) => {
    try {
        const { projectId, name, category, quantity, status, serialNumber, purchaseDate, remarks } = req.body;

        // Upload photo to Cloudinary if file exists
        let photoUrl = null;
        if (req.file) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            photoUrl = await uploadToCloudinary(req.file.buffer, 'lab-equipment');
        }

        const labEquipment = await LabEquipment.create({
            projectId,
            name,
            category,
            quantity: quantity || 1,
            status: status || 'active',
            serialNumber,
            purchaseDate,
            remarks,
            photo: photoUrl
        });

        console.log(`✅ Lab Equipment added: ${name}`);

        res.status(201).json({
            success: true,
            message: 'Lab equipment added successfully',
            data: labEquipment
        });
    } catch (error) {
        console.error('❌ Error adding lab equipment:', error);
        next(error);
    }
};

const getLabEquipments = async (req, res, next) => {
    try {
        const labEquipments = await LabEquipment.find()
            .populate('projectId', 'name location')
            .sort('-createdAt')
            .lean();

        res.json({
            success: true,
            data: labEquipments
        });
    } catch (error) {
        console.error('❌ Error fetching lab equipments:', error);
        next(error);
    }
};

// ============ CONSUMABLE GOODS ============

const addConsumableGoods = async (req, res, next) => {
    try {
        const { projectId, name, category, quantity, unit, minStockLevel, expiryDate, remarks } = req.body;

        // Upload photo to Cloudinary if file exists
        let photoUrl = null;
        if (req.file) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            photoUrl = await uploadToCloudinary(req.file.buffer, 'consumables');
        }

        const consumableGoods = await ConsumableGoods.create({
            projectId,
            name,
            category,
            quantity,
            unit,
            minStockLevel: minStockLevel || 0,
            expiryDate,
            remarks,
            photo: photoUrl
        });

        console.log(`✅ Consumable Goods added: ${name}`);

        res.status(201).json({
            success: true,
            message: 'Consumable goods added successfully',
            data: consumableGoods
        });
    } catch (error) {
        console.error('❌ Error adding consumable goods:', error);
        next(error);
    }
};

const getConsumableGoods = async (req, res, next) => {
    try {
        const consumableGoods = await ConsumableGoods.find()
            .populate('projectId', 'name location')
            .sort('-createdAt')
            .lean();

        res.json({
            success: true,
            data: consumableGoods
        });
    } catch (error) {
        console.error('❌ Error fetching consumable goods:', error);
        next(error);
    }
};

// ============ EQUIPMENT ============

const addEquipment = async (req, res, next) => {
    try {
        const { projectId, name, category, quantity, status, serialNumber, purchaseDate, remarks } = req.body;

        // Upload photo to Cloudinary if file exists
        let photoUrl = null;
        if (req.file) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            photoUrl = await uploadToCloudinary(req.file.buffer, 'equipment');
        }

        const equipment = await Equipment.create({
            projectId,
            name,
            category,
            quantity: quantity || 1,
            status: status || 'active',
            serialNumber,
            purchaseDate,
            remarks,
            photo: photoUrl
        });

        console.log(`✅ Equipment added: ${name}`);

        res.status(201).json({
            success: true,
            message: 'Equipment added successfully',
            data: equipment
        });
    } catch (error) {
        console.error('❌ Error adding equipment:', error);
        next(error);
    }
};

const getEquipments = async (req, res, next) => {
    try {
        const equipments = await Equipment.find()
            .populate('projectId', 'name location')
            .sort('-createdAt')
            .lean();

        res.json({
            success: true,
            data: equipments
        });
    } catch (error) {
        console.error('❌ Error fetching equipments:', error);
        next(error);
    }
};

// ============ BANK DETAILS ============

const getBankDetails = async (req, res, next) => {
    try {
        const banks = await BankDetail.find().sort('-createdAt');
        res.json({
            success: true,
            data: banks
        });
    } catch (error) {
        next(error);
    }
};

const getBankDetailWithTransactions = async (req, res, next) => {
    try {
        const { id } = req.params;
        const bank = await BankDetail.findById(id);

        if (!bank) {
            return res.status(404).json({
                success: false,
                error: 'Bank not found'
            });
        }

        // Fetch transactions from ALL sources linked to this bank
        // 1. Manual Transactions
        // 2. Expenses
        // 3. Vendor Payments
        // 4. Contractor Payments
        // 5. Labour Payments

        const [manualTransactions, expenses, vendorPayments, contractorPayments, labourPayments, creditorPayments, allBanks] = await Promise.all([
            Transaction.find({ bankId: id })
                .populate('addedBy', 'name role')
                .populate('creditorId', 'name')
                .populate('projectId', 'name')
                .lean(),
            Expense.find({ bankId: id })
                .populate('projectId', 'name')
                .populate('creditorId', 'name')
                .populate('addedBy', 'name role')
                .lean(),
            VendorPayment.find({ bankId: id })
                .populate('vendorId', 'name')
                .populate('creditorId', 'name')
                .populate('recordedBy', 'name role')
                .lean(),
            ContractorPayment.find({ bankId: id })
                .populate('contractorId', 'name')
                .populate('projectId', 'name')
                .populate('creditorId', 'name')
                .populate('paidBy', 'name role')
                .lean(),
            LabourPayment.find({ bankId: id })
                .populate('labourId', 'name')
                .populate('creditorId', 'name')
                .populate('userId', 'name role')
                .lean(),
            CreditorPayment.find({ bankId: id })
                .populate('creditorId', 'name')
                .populate('recordedBy', 'name role')
                .lean(),
            BankDetail.find().lean()
        ]);

        const bankDisplayName = `${bank.bankName}${bank.holderName ? ` (${bank.holderName})` : ''}`;
        const bankPartyType = 'Bank Account';

        const applyFromTo = (txn, counterpartyName, counterpartyType) => {
            const hasCounterparty = counterpartyName && counterpartyName !== '-';
            if (txn.type === 'credit') {
                return {
                    ...txn,
                    fromName: hasCounterparty ? counterpartyName : '-',
                    fromType: hasCounterparty ? counterpartyType : '',
                    toName: bankDisplayName,
                    toType: bankPartyType
                };
            }
            return {
                ...txn,
                fromName: bankDisplayName,
                fromType: bankPartyType,
                toName: hasCounterparty ? counterpartyName : '-',
                toType: hasCounterparty ? counterpartyType : ''
            };
        };

        // Normalize data
        const allTransactions = [
            ...manualTransactions.map(t => {
                let partyName = '-';
                let partyType = '';
                if (t.creditorId) {
                    partyName = t.creditorId.name;
                    partyType = 'Creditor';
                } else if (t.projectId) {
                    partyName = t.projectId.name;
                    partyType = 'Project';
                } else if (t.category === 'capital') {
                    partyName = 'Owner (Capital)';
                    partyType = 'Owner';
                } else if (t.description && t.description.includes('Wallet allocation to ')) {
                    partyName = t.description.replace('Wallet allocation to ', '').split(' - ')[0].trim();
                    partyType = 'Site Manager';
                } else if (t.description && t.description.startsWith('Transfer to ')) {
                    const rawBank = t.description.replace('Transfer to ', '').split(' - ')[0].trim();
                    const bankName = rawBank.split(' (')[0].trim();
                    const matchingBank = allBanks.find(b => b.bankName.toLowerCase() === bankName.toLowerCase());
                    partyName = matchingBank ? `${matchingBank.bankName} (${matchingBank.holderName})` : rawBank;
                    partyType = 'Bank Account';
                } else if (t.description && t.description.startsWith('Transfer from ')) {
                    const rawBank = t.description.replace('Transfer from ', '').split(' - ')[0].trim();
                    const bankName = rawBank.split(' (')[0].trim();
                    const matchingBank = allBanks.find(b => b.bankName.toLowerCase() === bankName.toLowerCase());
                    partyName = matchingBank ? `${matchingBank.bankName} (${matchingBank.holderName})` : rawBank;
                    partyType = 'Bank Account';
                }
                return applyFromTo({
                    ...t,
                    source: 'Manual Transaction',
                    amount: t.amount,
                    type: t.type,
                    refId: t._id,
                    refModel: 'Transaction'
                }, partyName, partyType);
            }),
            ...expenses.map(e => {
                let partyName = e.projectId?.name || 'General Expense';
                let partyType = 'Project';
                if (e.creditorId) {
                    partyName = e.creditorId.name;
                    partyType = 'Creditor';
                }
                return applyFromTo({
                    _id: e._id,
                    date: e.createdAt,
                    description: `Expense: ${e.name} (${e.category})`,
                    amount: e.amount,
                    type: 'debit',
                    category: 'expense',
                    source: 'Expense',
                    paymentMode: e.paymentMode,
                    bankId: e.bankId,
                    addedBy: e.addedBy,
                    refId: e._id,
                    refModel: 'Expense'
                }, partyName, partyType);
            }),
            ...vendorPayments.map(v => {
                const partyName = v.vendorId?.name || 'Unknown Vendor';
                let partyType = 'Vendor';
                if (v.creditorId) {
                    partyType = 'Creditor';
                }
                return applyFromTo({
                    _id: v._id,
                    date: v.date,
                    description: v.vendorId ? `Vendor Payment: ${v.vendorId.name}` : `Vendor Payment`,
                    amount: v.amount,
                    type: 'debit',
                    category: 'expense',
                    source: 'Vendor Payment',
                    paymentMode: v.paymentMode,
                    bankId: v.bankId,
                    addedBy: v.recordedBy,
                    refId: v._id,
                    refModel: 'VendorPayment'
                }, partyName, partyType);
            }),
            ...contractorPayments.map(c => {
                const partyName = c.contractorName || c.contractorId?.name || 'Unknown Contractor';
                let partyType = 'Contractor';
                if (c.creditorId) {
                    partyType = 'Creditor';
                }
                return applyFromTo({
                    _id: c._id,
                    date: c.date,
                    description: `Contractor Payment: ${partyName}`,
                    amount: c.amount,
                    type: 'debit',
                    category: 'expense',
                    source: 'Contractor Payment',
                    paymentMode: c.paymentMode,
                    bankId: c.bankId,
                    addedBy: c.paidBy,
                    refId: c._id,
                    refModel: 'ContractorPayment'
                }, partyName, partyType);
            }),
            ...labourPayments.map(l => {
                const partyName = l.labourId?.name || 'Unknown Labour';
                let partyType = 'Labour';
                if (l.creditorId) {
                    partyType = 'Creditor';
                }
                return applyFromTo({
                    _id: l._id,
                    date: l.createdAt,
                    description: l.labourId ? `Labour Payment: ${l.labourId.name}` : `Labour Payment`,
                    amount: l.finalAmount,
                    type: 'debit',
                    category: 'expense',
                    source: 'Labour Payment',
                    paymentMode: l.paymentMode,
                    bankId: l.bankId,
                    addedBy: l.userId,
                    refId: l._id,
                    refModel: 'LabourPayment'
                }, partyName, partyType);
            }),
            ...creditorPayments.map(cp => {
                const partyName = cp.creditorId?.name || 'Unknown Creditor';
                const partyType = 'Creditor';
                return applyFromTo({
                    _id: cp._id,
                    date: cp.date,
                    description: `Creditor Payment: ${partyName}`,
                    amount: cp.amount,
                    type: cp.type === 'debit' ? 'credit' : 'debit', // Bank receives debit (reduces bank bal), bank receives credit (increases bank bal)
                    category: 'expense',
                    source: 'Creditor Payment',
                    paymentMode: cp.paymentMode,
                    bankId: cp.bankId,
                    addedBy: cp.recordedBy,
                    refId: cp._id,
                    refModel: 'CreditorPayment'
                }, partyName, partyType);
            })
        ];

        // Sort by date (newest first)
        allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Calculate totals
        const totalCredit = allTransactions
            .filter(t => t.type === 'credit')
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        const totalDebit = allTransactions
            .filter(t => t.type === 'debit')
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        res.json({
            success: true,
            data: {
                bank,
                transactions: allTransactions,
                summary: {
                    totalCredit,
                    totalDebit,
                    netBalance: totalCredit - totalDebit
                }
            }
        });
    } catch (error) {
        console.error('Error fetching bank detail:', error);
        next(error);
    }
};

const addBankDetail = async (req, res, next) => {
    try {
        const { holderName, bankName, branch, accountNumber, ifscCode } = req.body;

        // Check if account number already exists
        const existing = await BankDetail.findOne({ accountNumber });
        if (existing) {
            return res.status(400).json({
                success: false,
                error: 'Account number already exists'
            });
        }

        const bank = await BankDetail.create({
            holderName,
            bankName,
            branch,
            accountNumber,
            ifscCode,
            addedBy: req.user.userId
        });

        res.status(201).json({
            success: true,
            data: bank
        });
    } catch (error) {
        next(error);
    }
};


// Transfer funds between banks
const transferBankToBank = async (req, res, next) => {
    try {
        const { sourceBankId, destBankId, amount, date, description } = req.body;

        if (!sourceBankId || !destBankId || !amount) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        if (sourceBankId === destBankId) {
            return res.status(400).json({ success: false, error: 'Source and Destination banks cannot be same' });
        }

        const sourceBank = await BankDetail.findById(sourceBankId);
        const destBank = await BankDetail.findById(destBankId);

        if (!sourceBank || !destBank) {
            return res.status(404).json({ success: false, error: 'Bank not found' });
        }

        // Create Debit Transaction (Source)
        const debitTransaction = new Transaction({
            amount: parseFloat(amount),
            type: 'debit',
            category: 'other',
            description: `Transfer to ${destBank.bankName} (${destBank.holderName}) - ${description || ''}`,
            paymentMode: 'bank',
            date: date || new Date(),
            addedBy: req.user.userId,
            bankId: sourceBankId
        });

        // Create Credit Transaction (Destination)
        const creditTransaction = new Transaction({
            amount: parseFloat(amount),
            type: 'credit',
            category: 'other',
            description: `Transfer from ${sourceBank.bankName} (${sourceBank.holderName}) - ${description || ''}`,
            paymentMode: 'bank',
            date: date || new Date(),
            addedBy: req.user.userId,
            bankId: destBankId
        });

        await debitTransaction.save();
        await creditTransaction.save();

        res.json({
            success: true,
            message: 'Transfer successful',
            data: { debit: debitTransaction, credit: creditTransaction }
        });

    } catch (error) {
        console.error('Error transferring funds:', error);
        next(error);
    }
};



const deleteTransaction = async (req, res, next) => {
    try {
        const { id } = req.params;
        const transaction = await Transaction.findById(id);

        if (!transaction) return res.status(404).json({ success: false, error: 'Transaction not found' });

        // Reverse Creditor update if applicable
        if (transaction.creditorId) {
            const isCredit = transaction.type === 'credit';
            const balanceChange = isCredit ? -transaction.amount : transaction.amount;
            await Creditor.findByIdAndUpdate(transaction.creditorId, {
                $inc: { currentBalance: balanceChange },
                $pull: { transactions: { refId: transaction._id } }
            });
        }

        // Reverse Bank update if applicable
        if (transaction.bankId) {
            const isCredit = transaction.type === 'credit';
            const balanceChange = isCredit ? -transaction.amount : transaction.amount;
            await BankDetail.findByIdAndUpdate(transaction.bankId, {
                $inc: { currentBalance: balanceChange },
                $pull: { transactions: { refId: transaction._id } }
            });
        }

        await transaction.deleteOne();

        res.json({ success: true, message: 'Transaction deleted successfully' });
    } catch (error) {
        next(error);
    }
};

const deleteVendorPayment = async (req, res, next) => {
    try {
        const { id } = req.params;
        const payment = await VendorPayment.findById(id);
        if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

        const vendor = await Vendor.findById(payment.vendorId);
        if (vendor) {
            let amountLeft = payment.amount;

            if (vendor.advancePayment > 0) {
                const reduceAdv = Math.min(vendor.advancePayment, amountLeft);
                vendor.advancePayment -= reduceAdv;
                amountLeft -= reduceAdv;
            }

            if (amountLeft > 0) {
                vendor.pendingAmount = (vendor.pendingAmount || 0) + amountLeft;
            }

            await vendor.save();
        }

        // Reverse Bank
        if (payment.bankId) {
            await BankDetail.findByIdAndUpdate(payment.bankId, {
                $inc: { currentBalance: payment.amount }, // Credit back
                $push: {
                    transactions: {
                        type: 'credit',
                        amount: payment.amount,
                        date: new Date(),
                        description: `Reversal of vendor payment (Deleted)`,
                        refId: payment._id,
                        refModel: 'VendorPayment'
                    }
                }
            });
        }

        // Reverse Creditor
        if (payment.creditorId) {
            await Creditor.findByIdAndUpdate(payment.creditorId, {
                $inc: { currentBalance: payment.amount }, // Credit back (Liability increases)
                $pull: { transactions: { refId: payment._id } }
            });
        }

        await payment.deleteOne();
        res.json({ success: true, message: 'Vendor payment deleted' });
    } catch (error) {
        next(error);
    }
};

const deleteContractorPayment = async (req, res, next) => {
    try {
        const { id } = req.params;
        const payment = await ContractorPayment.findById(id);
        if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

        const contractor = await Contractor.findById(payment.contractorId);
        if (contractor) {
            // Check if the deleted payment was for a past project in history
            const historyIndex = contractor.projectHistory ? contractor.projectHistory.findIndex(h => 
                String(h.projectId) === String(payment.projectId)
            ) : -1;
            const isPastProject = historyIndex !== -1;

            if (isPastProject) {
                // Revert past project payment
                const histEntry = contractor.projectHistory[historyIndex];
                if (payment.isAdvance) {
                    histEntry.advancePayment = Math.max(0, (histEntry.advancePayment || 0) - payment.amount);
                } else {
                    histEntry.totalPaid = Math.max(0, (histEntry.totalPaid || 0) - payment.amount);
                }
                contractor.projectHistory[historyIndex] = histEntry;
                contractor.markModified('projectHistory');
            } else {
                // Revert current project payment from activeAssignments
                let assignmentIndex = contractor.activeAssignments.findIndex(a => {
                    const aProjId = a.projectId ? a.projectId.toString() : 'unassigned';
                    const pProjId = (payment.projectId && payment.projectId.toString() !== 'null' && payment.projectId.toString() !== 'undefined') ? payment.projectId.toString() : 'unassigned';
                    return aProjId === pProjId;
                });
                
                // Fallback to first assignment if no exact project match found
                if (assignmentIndex === -1 && contractor.activeAssignments.length > 0) {
                    assignmentIndex = 0;
                }

                if (assignmentIndex !== -1) {
                    const assignment = contractor.activeAssignments[assignmentIndex];
                    let amountLeft = payment.amount;
                    
                    if (payment.isAdvance) {
                        assignment.advancePayment = Math.max(0, (assignment.advancePayment || 0) - payment.amount);
                    } else {
                        // Revert advance recovered logic if any? We don't store advanceRecovered explicitly on payment. 
                        // But we can just reduce totalPaid.
                        assignment.totalPaid = Math.max(0, (assignment.totalPaid || 0) - payment.amount);
                        
                        if (assignment.advancePayment > 0) {
                            const reduceAdv = Math.min(assignment.advancePayment, amountLeft);
                            assignment.advancePayment -= reduceAdv;
                            amountLeft -= reduceAdv;
                        }
                        if (amountLeft > 0) {
                            assignment.pendingAmount = (assignment.pendingAmount || 0) + amountLeft;
                        }
                    }

                    // Mirror to root for backward compatibility
                    if (assignmentIndex === 0) {
                        contractor.totalPaid = assignment.totalPaid;
                        contractor.advancePayment = assignment.advancePayment;
                        contractor.pendingAmount = assignment.pendingAmount;
                    }
                } else {
                    // Fallback to root if activeAssignments is empty
                    let amountLeft = payment.amount;
                    if (contractor.advancePayment > 0) {
                        const reduceAdv = Math.min(contractor.advancePayment, amountLeft);
                        contractor.advancePayment -= reduceAdv;
                        amountLeft -= reduceAdv;
                    }
                    if (amountLeft > 0) {
                        contractor.pendingAmount = (contractor.pendingAmount || 0) + amountLeft;
                    }
                    contractor.totalPaid = Math.max(0, (contractor.totalPaid || 0) - payment.amount);
                }
            }
            await contractor.save();
        }

        // Reverse Bank
        if (payment.bankId) {
            await BankDetail.findByIdAndUpdate(payment.bankId, {
                $inc: { currentBalance: payment.amount },
                $push: {
                    transactions: {
                        type: 'credit',
                        amount: payment.amount,
                        date: new Date(),
                        description: `Reversal of contractor payment (Deleted)`,
                        refId: payment._id,
                        refModel: 'ContractorPayment'
                    }
                }
            });
        }

        // Reverse Creditor
        if (payment.creditorId) {
            await Creditor.findByIdAndUpdate(payment.creditorId, {
                $inc: { currentBalance: payment.amount },
                $pull: { transactions: { refId: payment._id } }
            });
        }

        await payment.deleteOne();
        res.json({ success: true, message: 'Contractor payment deleted' });
    } catch (error) {
        next(error);
    }
};

const createItemName = async (req, res, next) => {
    try {
        const { name, category } = req.body;
        if (!name || !category) {
            return res.status(400).json({ success: false, error: 'Name and Category are required' });
        }
        const itemName = new ItemName({ name, category });
        await itemName.save();
        res.status(201).json({ success: true, data: itemName });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, error: 'Item name already exists in this category' });
        }
        next(error);
    }
};

const getItemNames = async (req, res, next) => {
    try {
        const { category } = req.query;
        const query = category ? { category } : {};
        const names = await ItemName.find(query).sort('name');
        res.json({ success: true, data: names });
    } catch (error) {
        next(error);
    }
};

const deleteItemName = async (req, res, next) => {
    try {
        const { id } = req.params;
        await ItemName.findByIdAndDelete(id);
        res.json({ success: true, message: 'Item name deleted successfully' });
    } catch (error) {
        next(error);
    }
};

// ============ PASSWORD VERIFICATION ============
const verifyPassword = async (req, res, next) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ success: false, error: 'Password is required' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ success: false, error: 'Invalid admin password' });
        }

        res.json({ success: true, message: 'Authentication successful' });
    } catch (error) {
        next(error);
    }
};
// Get admin profile
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

// Get Fuel Usage for a Machine
const getMachineFuelUsage = async (req, res, next) => {
    try {
        const { id } = req.params;
        const fuelUsage = await StockOut.find({ machineId: id })
            .populate('projectId', 'name')
            .populate('recordedBy', 'name')
            .sort({ date: -1 });

        res.json({
            success: true,
            data: fuelUsage
        });
    } catch (error) {
        console.error('Error fetching machine fuel usage:', error);
        next(error);
    }
};

module.exports = {
    getDashboard,
    getProjects,
    createProject,
    updateProject,
    deleteProject,
    getProjectDetail,
    getMachines,
    createMachine,
    updateMachine,
    deleteMachine,
    returnRentedMachine,
    reRentMachine,
    assignMachineQuantity,
    unassignMachineQuantity,
    getMachineFuelUsage,
    getStocks,
    createStock,
    updateStock,
    deleteStock,
    getVendors,
    createVendor,
    updateVendor,
    deleteVendor,
    recordVendorPayment,
    getVendorPayments,
    getExpenses,
    createExpense,
    deleteExpense,
    getUsers,
    createUser,
    updateUser,
    deleteUser,
    getContractors,
    createContractor,
    updateContractor,
    deleteContractor,
    getContractorPayments,
    createContractorPayment,
    getTransfers,
    createTransfer,
    getAccounts,
    addCapital,
    addTransaction,
    allocateFunds,
    generateReport,
    getAttendance,
    getLabourAttendance,
    getLabourPayments,
    getNotifications,
    sendNotification,
    markNotificationRead,
    getLabours,
    addLabEquipment,
    getLabEquipments,
    addConsumableGoods,
    getConsumableGoods,
    addEquipment,
    getEquipments,
    addBankDetail,
    getBankDetailWithTransactions,
    getBankDetails,
    transferBankToBank,
    deleteTransaction,
    updateTransactionMeta,
    deleteVendorPayment,
    deleteContractorPayment,

    // Item Names (Stock Detail)
    createItemName,
    getItemNames,
    deleteItemName,

    // Notifications
    createNotification,
    getNotifications,
    sendNotification,
    markNotificationRead,
    verifyPassword,
    getProfile,
    getMachineFuelUsage
};
