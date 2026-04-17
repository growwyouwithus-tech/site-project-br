/**
 * Admin Controller - MongoDB Version
 * Handles all admin-specific operations with MongoDB
 */

const mongoose = require('mongoose');
const { User, Project, Vendor, VendorPayment, Expense, Labour, Contractor, ContractorPayment, LabourPayment, Machine, Stock, LabEquipment, ConsumableGoods, Equipment, Transaction, Transfer, BankDetail, Creditor, CreditorPayment, Attendance, LabourAttendance, ItemName, Notification } = require('../models');

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
        const [expenses, labours, stocks, machines, contractors] = await Promise.all([
            Expense.find({ projectId: id }).lean(),
            Labour.find({ assignedSite: id }).lean(),
            Stock.find({ projectId: id }).populate('vendorId', 'name').sort('-createdAt').lean(),
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
        const vendors = await Vendor.find().sort('-createdAt').lean();
        res.json({
            success: true,
            data: vendors
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

        const paidAmount = parseFloat(amount);
        const currentPending = vendor.pendingAmount || 0;
        const currentAdvance = vendor.advancePayment || 0; // Ensure field exists

        let newPending = currentPending - paidAmount;
        if (newPending < 0) {
            vendor.advancePayment = currentAdvance + Math.abs(newPending);
            vendor.pendingAmount = 0;
        } else {
            vendor.pendingAmount = newPending;
        }

        const newPayment = new VendorPayment({
            vendorId,
            amount: paidAmount,
            date: date || new Date(),
            paymentMode,
            bankId: bankId && bankId !== '' ? bankId : undefined,
            creditorId: creditorId && creditorId !== '' ? creditorId : undefined,
            remarks
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
        const expenses = await Expense.find()
            .populate('projectId', 'name location')
            .populate('addedBy', 'name email')
            .sort('-createdAt')
            .lean();

        res.json({
            success: true,
            data: expenses
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
                $push: {
                    transactions: {
                        type: 'credit',
                        amount: expense.amount,
                        date: new Date(),
                        description: `Reversal of expense: ${expense.name} (Deleted)`,
                        refId: expense._id,
                        refModel: 'Expense'
                    }
                }
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
        const contractor = await Contractor.findByIdAndUpdate(id, req.body, { new: true });
        if (!contractor) {
            return res.status(404).json({
                success: false,
                error: 'Contractor not found'
            });
        }
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
        const { contractorId, contractorName, date, amount, paymentMode, remark, machineRent, rentDeducted, bankId, creditorId } = req.body;
        const userId = req.user.userId;

        const contractor = await Contractor.findById(contractorId);
        if (!contractor) {
            return res.status(404).json({ success: false, error: 'Contractor not found' });
        }

        // Create Payment Record
        const payment = new ContractorPayment({
            contractorId,
            contractorName: contractor.name,
            amount: parseFloat(amount),
            date: date || Date.now(),
            remark: remark,
            paymentMode: paymentMode || 'cash',
            bankId: bankId && bankId !== '' ? bankId : undefined,
            creditorId: creditorId && creditorId !== '' ? creditorId : undefined,
            recordedBy: userId,
            machineRent: machineRent ? parseFloat(machineRent) : 0,
            rentDeducted: rentDeducted ? parseFloat(rentDeducted) : 0
        });
        await payment.save();

        // Update Contractor Financials (Advance/Pending)
        const paidAmount = parseFloat(amount);
        const currentPending = contractor.pendingAmount || 0;
        const currentAdvance = contractor.advancePayment || 0;

        let newPending = currentPending - paidAmount;
        if (newPending < 0) {
            contractor.advancePayment = currentAdvance + Math.abs(newPending);
            contractor.pendingAmount = 0;
        } else {
            contractor.pendingAmount = newPending;
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
        // Upload photo to Cloudinary if file exists
        let machinePhotoUrl = null;
        if (req.file) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            machinePhotoUrl = await uploadToCloudinary(req.file.buffer, 'machines');
        }

        const machineData = {
            ...req.body,
            machinePhoto: machinePhotoUrl || req.body.machinePhoto,
            // Convert empty string to null for optional ObjectId fields
            projectId: req.body.projectId && req.body.projectId.trim() !== '' ? req.body.projectId : null
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

        // Normal updates
        Object.keys(updates).forEach(key => {
            if (key !== 'maintenanceCost' && key !== 'maintenanceDescription') {
                machine[key] = updates[key];
            }
        });

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

        // Verify machine is rented and in-use
        if (machine.ownershipType !== 'rented') {
            return res.status(400).json({
                success: false,
                error: 'Only rented equipment can be returned'
            });
        }

        if (machine.status !== 'in-use') {
            return res.status(400).json({
                success: false,
                error: 'Machine is not currently in use'
            });
        }

        // Calculate rental details
        const assignedDate = new Date(machine.assignedAt);
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
        const rate = parseFloat(machine.assignedAsRental ? machine.assignedRentalPerDay : machine.perDayExpense) || 0;

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

        // Update machine status
        machine.status = 'returned';
        machine.returnedAt = returnDate;
        machine.totalRentPaid = totalRent;

        // Update History
        if (machine.assignmentHistory && machine.assignmentHistory.length > 0) {
            // We assume the last entry is the current one because we push on assignment
            const lastIdx = machine.assignmentHistory.length - 1;
            machine.assignmentHistory[lastIdx].returnedAt = returnDate;
            machine.assignmentHistory[lastIdx].returnStatus = 'returned';
            machine.assignmentHistory[lastIdx].totalRent = totalRent;
            machine.assignmentHistory[lastIdx].durationMinutes = machine.rentalType === 'perHour' ? diffValue : diffValue * 24 * 60;
        }

        await machine.save();

        // Create expense entry for rental
        const expense = new Expense({
            projectId: machine.projectId,
            name: `Rental return: ${machine.name}${machine.plateNumber ? ' [' + machine.plateNumber + ']' : ''}`,
            amount: totalRent,
            category: 'machine_rental',
            remarks: `${diffDisplay} @ ₹${rate}/${machine.rentalType === 'perHour' ? 'hr' : 'day'}. Assigned: ${assignedDate.toLocaleDateString()} ${assignedDate.toLocaleTimeString()}, Returned: ${returnDate.toLocaleDateString()} ${returnDate.toLocaleTimeString()}`,
            addedBy: req.user.userId
        });
        await expense.save();

        // Update project expenses if projectId exists
        if (machine.projectId) {
            await Project.findByIdAndUpdate(
                machine.projectId,
                { $inc: { expenses: totalRent } }
            );
        }

        res.json({
            success: true,
            message: 'Machine returned and expense recorded successfully',
            data: {
                machine,
                expense,
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

const getStocks = async (req, res, next) => {
    try {
        console.log(' Fetching stocks (ultra-fast)...');
        const startTime = Date.now();

        // Get stocks without any population for maximum speed
        const stocks = await Stock.find()
            .select('projectId vendorId materialName unit quantity unitPrice totalPrice remarks photo createdAt')
            .sort('-createdAt')
            .lean()
            .maxTimeMS(2000); // 2 second timeout

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
            transferData.materialName = itemId; // For stock/consumables, we might store Name or ID. 
            // If Stock transfer passes "materialName" as ID? No, frontend passes ID or Name?
            // Frontend: value={s.materialName} for Stock (Transfer.jsx line 324 in overwritten file)
            // Frontend: value={cg._id} for Consumable (Transfer.jsx line 348)

            if (type === 'consumable-goods') {
                // For Consumables, we passed ID. 
                // We should probably store reference ID if Transfer supports it.
                // If Transfer model only has materialName (String), we store name.
                // Let's look up name if ID passed.
                const item = await ConsumableGoods.findById(itemId);
                if (item) transferData.materialName = item.name;
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
            // itemId is materialName for Stock (as per frontend)
            // Wait, logic in Step 398 used Stock.findById(itemId).
            // My rewrote Transfer.jsx uses: value={s.materialName} for stock.
            // THIS IS A MISMATCH. Backend expects ID to deduct? 
            // Or verify Stock logic. 
            // Step 398 Logic: const sourceStock = await Stock.findById(itemId);
            // If frontend sends Name, this fails.
            // I should check strictness. 
            // Let's assume frontend sends Name for stock (from my rewrite).
            // Then finding source stock needs (projectId + materialName).

            const sourceStock = await Stock.findOne({ projectId: fromProject, materialName: itemId });

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
                .sort('-date')
                .limit(100)
                .lean(),
            ContractorPayment.find(dateFilter.$gte || dateFilter.$lte ? { date: dateFilter } : {})
                .sort('-date')
                .limit(100)
                .lean(),
            LabourPayment.find(dateFilter.$gte || dateFilter.$lte ? { date: dateFilter } : {})
                .populate('labourId', 'name')
                .sort('-createdAt')
                .limit(100)
                .lean(),
            CreditorPayment.find(dateFilter.$gte || dateFilter.$lte ? { date: dateFilter } : {})
                .populate('creditorId', 'name')
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
                source: t.addedBy ? `${t.addedBy.name} (${t.addedBy.role})` : 'System',
                receivedFrom: t.category === 'third_party_funds' ? t.description.split(' - ')[0].replace('Received from: ', '') : null,
                projectId: t.projectId,
                relatedId: t.relatedId,
                addedBy: t.addedBy 
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
                source: e.addedBy ? `${e.addedBy.name} (${e.addedBy.role})` : 'System'
            });
        });

        // Add vendor payments as debit transactions
        vendorPayments.forEach(vp => {
            allTransactions.push({
                _id: vp._id,
                refModel: 'VendorPayment',
                date: ensureDate(vp.date, vp.createdAt),
                description: `Payment to ${vp.vendorId?.name || 'Vendor'}${vp.remark ? ` - ${vp.remark}` : ''}`,
                amount: vp.amount || 0,
                type: 'debit',
                category: 'vendor_payment',
                paymentMode: normalizeMode(vp.paymentMode),
                source: 'Vendor Payment'
            });
        });

        // Add contractor payments as debit transactions
        contractorPayments.forEach(cp => {
            allTransactions.push({
                _id: cp._id,
                refModel: 'ContractorPayment',
                date: ensureDate(cp.date, cp.createdAt),
                description: `Payment to ${cp.contractorName}${cp.remark ? ` - ${cp.remark}` : ''}`,
                amount: cp.amount || 0,
                type: 'debit',
                category: 'contractor_payment',
                paymentMode: normalizeMode(cp.paymentMode),
                source: 'Contractor Payment'
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
                source: 'Creditor Payment'
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
                source: 'Labour Payment'
            });
        });

        // Sort all transactions by date (newest first)
        allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Calculate totals
        // Capital Credits (money added)
        const capitalCredits = manualTransactions
            .filter(t => t.category === 'capital' && t.type === 'credit')
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        // Total Debits (all money spent - expenses, payments, etc.)
        const totalDebits = allTransactions
            .filter(t => t.type === 'debit')
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        // Net Capital = Capital Credits - Total Debits
        const capital = capitalCredits - totalDebits;

        // Total Expenses (for display purposes)
        const totalExpenses = allTransactions
            .filter(t => t.type === 'debit')
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
        const { amount, description, paymentMode, date } = req.body;

        const transaction = new Transaction({
            amount: parseFloat(amount),
            type: 'credit',
            category: 'capital',
            description: description || 'Capital addition',
            paymentMode: paymentMode || 'bank',
            date: date || new Date(),
            addedBy: req.user.userId,
            bankId: req.body.bankId || null,
            projectId: req.body.projectId || null
        });

        await transaction.save();

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
        const { type, startDate, endDate } = req.query;

        let data = [];

        switch (type) {
            case 'expenses':
                data = await Expense.find();
                if (startDate || endDate) {
                    const filter = {};
                    if (startDate) filter.$gte = new Date(startDate);
                    if (endDate) filter.$lte = new Date(endDate);
                    data = data.filter(expense => {
                        const expenseDate = new Date(expense.createdAt);
                        if (startDate && expenseDate < new Date(startDate)) return false;
                        if (endDate && expenseDate > new Date(endDate)) return false;
                        return true;
                    });
                }
                break;

            case 'attendance':
                data = await User.find({ role: 'sitemanager' });
                break;

            case 'stock':
                data = await Stock.find();
                break;

            case 'machines':
                data = await Machine.find();
                break;

            case 'contractors':
                data = await Contractor.find();
                break;

            case 'pl':
                // Profit & Loss report
                const expenses = await Expense.find();
                const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
                const projects = await Project.find();
                const totalBudget = projects.reduce((sum, proj) => sum + (proj.budget || 0), 0);
                const profit = totalBudget - totalExpenses;

                data = [
                    { type: 'Revenue', amount: totalBudget, description: 'Total Project Budget' },
                    { type: 'Expenses', amount: totalExpenses, description: 'Total Expenses' },
                    { type: 'Profit', amount: profit, description: 'Net Profit/Loss' }
                ];
                break;

            case 'full':
            default:
                // Full report with all data
                const [allExpenses, allProjects, allUsers, allStocks, allMachines, allContractors] = await Promise.all([
                    Expense.find(),
                    Project.find(),
                    User.find(),
                    Stock.find(),
                    Machine.find(),
                    Contractor.find()
                ]);

                data = {
                    summary: {
                        totalProjects: allProjects.length,
                        totalExpenses: allExpenses.reduce((sum, exp) => sum + (exp.amount || 0), 0),
                        totalUsers: allUsers.length,
                        totalStocks: allStocks.length,
                        totalMachines: allMachines.length,
                        totalContractors: allContractors.length
                    },
                    expenses: allExpenses,
                    projects: allProjects,
                    users: allUsers,
                    stocks: allStocks,
                    machines: allMachines,
                    contractors: allContractors
                };
                break;
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

        const [manualTransactions, expenses, vendorPayments, contractorPayments, labourPayments] = await Promise.all([
            Transaction.find({ bankId: id }).populate('addedBy', 'name role').lean(),
            Expense.find({ bankId: id }).lean(),
            VendorPayment.find({ bankId: id }).lean(),
            ContractorPayment.find({ bankId: id }).lean(),
            LabourPayment.find({ bankId: id }).lean()
        ]);

        // Normalize data
        const allTransactions = [
            ...manualTransactions.map(t => ({
                ...t,
                source: 'Manual Transaction',
                amount: t.amount,
                type: t.type
            })),
            ...expenses.map(e => ({
                _id: e._id,
                date: e.createdAt,
                description: `Expense: ${e.name} (${e.category})`,
                amount: e.amount,
                type: 'debit',
                category: 'expense',
                source: 'Expense',
                paymentMode: e.paymentMode,
                bankId: e.bankId
            })),
            ...vendorPayments.map(v => ({
                _id: v._id,
                date: v.date,
                description: `Vendor Payment`, // Can fetch vendor name if populated, but keeping simple for now
                amount: v.amount,
                type: 'debit',
                category: 'expense',
                source: 'Vendor Payment',
                paymentMode: v.paymentMode,
                bankId: v.bankId
            })),
            ...contractorPayments.map(c => ({
                _id: c._id,
                date: c.date,
                description: `Contractor Payment: ${c.contractorName}`,
                amount: c.amount,
                type: 'debit',
                category: 'expense',
                source: 'Contractor Payment',
                paymentMode: c.paymentMode,
                bankId: c.bankId
            })),
            ...labourPayments.map(l => ({
                _id: l._id,
                date: l.createdAt, // LabourPayment schema has timestamps
                description: `Labour Payment`,
                amount: l.finalAmount,
                type: 'debit',
                category: 'expense',
                source: 'Labour Payment',
                paymentMode: l.paymentMode,
                bankId: l.bankId
            }))
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
            description: `Transfer to ${destBank.bankName} - ${description || ''}`,
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
            description: `Transfer from ${sourceBank.bankName} - ${description || ''}`,
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
            let amountLeft = payment.amount;
            if (contractor.advancePayment > 0) {
                const reduceAdv = Math.min(contractor.advancePayment, amountLeft);
                contractor.advancePayment -= reduceAdv;
                amountLeft -= reduceAdv;
            }
            if (amountLeft > 0) {
                contractor.pendingAmount = (contractor.pendingAmount || 0) + amountLeft;
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
    getProfile
};
