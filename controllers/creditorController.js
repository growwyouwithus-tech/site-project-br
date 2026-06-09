const { Creditor } = require('../models');

// Get all creditors
const getCreditors = async (req, res, next) => {
    try {
        const creditors = await Creditor.find().sort('-createdAt');
        res.json({
            success: true,
            data: creditors
        });
    } catch (error) {
        next(error);
    }
};

// Create new creditor
const createCreditor = async (req, res, next) => {
    try {
        const { name, mobile, address } = req.body;

        const creditor = await Creditor.create({
            name,
            mobile,
            address,
            addedBy: req.user.userId
        });

        res.status(201).json({
            success: true,
            data: creditor
        });
    } catch (error) {
        next(error);
    }
};

// Update creditor
const updateCreditor = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, mobile, address } = req.body;

        const creditor = await Creditor.findByIdAndUpdate(
            id,
            { name, mobile, address },
            { new: true }
        );

        if (!creditor) {
            return res.status(404).json({ success: false, error: 'Creditor not found' });
        }

        res.json({
            success: true,
            data: creditor
        });
    } catch (error) {
        next(error);
    }
};

// Delete creditor
const deleteCreditor = async (req, res, next) => {
    try {
        const { id } = req.params;
        const creditor = await Creditor.findByIdAndDelete(id);

        if (!creditor) {
            return res.status(404).json({ success: false, error: 'Creditor not found' });
        }

        res.json({
            success: true,
            message: 'Creditor deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};

// Get creditor details with transactions
const getCreditorDetails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const creditor = await Creditor.findById(id);

        if (!creditor) {
            return res.status(404).json({ success: false, error: 'Creditor not found' });
        }

        // Transactions are embedded in the model for simplicity in this design
        // Alternatively, we could query related collections if we didn't embed them.
        // But our plan is to PUSH transactions to this array when payments are made.

        res.json({
            success: true,
            data: creditor
        });
    } catch (error) {
        next(error);
    }
};

// Record creditor payment
const recordCreditorPayment = async (req, res, next) => {
    try {
        const { creditorId, amount, date, paymentMode, remarks, bankId, sourceCreditorId } = req.body;
        const userId = req.user.userId;

        const creditor = await Creditor.findById(creditorId);
        if (!creditor) {
            return res.status(404).json({ success: false, error: 'Target Creditor not found' });
        }

        const paidAmount = parseFloat(amount);
        // Upload slip to Cloudinary if file exists
        let slipUrl = null;
        if (req.file) {
            const { uploadToCloudinary } = require('../config/cloudinary');
            slipUrl = await uploadToCloudinary(req.file.buffer, 'slips');
        }

        // Inter-creditor transfer logic
        if (sourceCreditorId && sourceCreditorId !== '') {
            const sourceCreditor = await Creditor.findById(sourceCreditorId);
            if (!sourceCreditor) {
                return res.status(404).json({ success: false, error: 'Source creditor not found' });
            }

            // Create Payment Record
            const payment = new CreditorPayment({
                creditorId,
                amount: paidAmount,
                date: date || Date.now(),
                paymentMode: 'creditor', // Explicitly mark as creditor transfer
                remarks: `Transfer from ${sourceCreditor.name}: ${remarks || ''}`,
                slip: slipUrl,
                bankId: undefined,
                recordedBy: userId
            });
            await payment.save();

            // Deduct from Source Creditor
            sourceCreditor.currentBalance -= paidAmount;
            sourceCreditor.transactions.push({
                type: 'debit',
                amount: paidAmount,
                date: date || new Date(),
                description: `Payment transferred to ${creditor.name}`,
                refId: payment._id,
                refModel: 'CreditorPayment'
            });
            await sourceCreditor.save();

            // Add to Destination Creditor
            // User requested wallet logic: Creditor receiving money = Plus
            creditor.currentBalance += paidAmount;
            creditor.transactions.push({
                type: 'credit',
                amount: paidAmount,
                date: date || new Date(),
                description: `Payment recd from ${sourceCreditor.name}`,
                refId: payment._id,
                refModel: 'CreditorPayment'
            });
            await creditor.save();

            return res.status(201).json({
                success: true,
                message: 'Inter-creditor payment recorded successfully',
                data: payment
            });
        }

        // Standard Payment (Cash/Bank/check etc)
        // Create Payment Record
        const payment = new CreditorPayment({
            creditorId,
            amount: paidAmount,
            date: date || Date.now(),
            paymentMode,
            remarks,
            slip: slipUrl,
            bankId: bankId && bankId !== '' ? bankId : undefined,
            recordedBy: userId
        });
        await payment.save();

        // Update Creditor Balance
        // User requested wallet logic: Company paying the creditor -> Creditor wallet receives money -> Balance INCREASES (+)
        creditor.currentBalance += paidAmount;

        // Push transaction to creditor
        creditor.transactions.push({
            type: 'credit', // Wallet receives money = Credit
            amount: paidAmount,
            date: date || new Date(),
            description: `Payment Recd: ${remarks || ''}`,
            refId: payment._id,
            refModel: 'CreditorPayment'
        });

        await creditor.save();

        // If bankId is provided, record transaction in bank
        if (bankId && bankId !== '') {
            await BankDetail.findByIdAndUpdate(bankId, {
                $inc: { currentBalance: -paidAmount },
                $push: {
                    transactions: {
                        type: 'debit',
                        amount: paidAmount,
                        date: date || new Date(),
                        description: `Payment to Creditor: ${creditor.name}`,
                        refId: payment._id,
                        refModel: 'CreditorPayment'
                    }
                }
            });
        }

        res.status(201).json({
            success: true,
            message: 'Creditor payment recorded successfully',
            data: payment
        });
    } catch (error) {
        next(error);
    }
};

// Delete creditor payment
const deleteCreditorPayment = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { CreditorPayment, BankDetail } = require('../models');
        const payment = await CreditorPayment.findById(id);

        let foundAny = false;

        // 1. Clean up Creditor
        // Find ALL creditors that have this transaction (could be source and destination in a transfer)
        const creditors = await Creditor.find({ 'transactions.refId': id });
        for (let creditor of creditors) {
            const tx = creditor.transactions.find(t => t.refId?.toString() === id.toString());
            if (tx) {
                // Reverse balance
                if (tx.type === 'credit') creditor.currentBalance -= tx.amount;
                else creditor.currentBalance += tx.amount;
                
                // Remove transaction
                creditor.transactions = creditor.transactions.filter(t => t.refId?.toString() !== id.toString());
                await creditor.save();
                foundAny = true;
            }
        }

        // 2. Clean up BankDetail
        const banks = await BankDetail.find({ 'transactions.refId': id });
        for (let bank of banks) {
            const tx = bank.transactions.find(t => t.refId?.toString() === id.toString());
            if (tx) {
                // Reverse balance (if it was debit, we increase back)
                if (tx.type === 'debit') bank.currentBalance += tx.amount;
                else bank.currentBalance -= tx.amount;
                
                // Remove transaction
                bank.transactions = bank.transactions.filter(t => t.refId?.toString() !== id.toString());
                await bank.save();
                foundAny = true;
            }
        }

        if (payment) {
            await payment.deleteOne();
            foundAny = true;
        }

        if (!foundAny) {
            return res.status(404).json({ success: false, error: 'Payment not found' });
        }

        res.json({
            success: true,
            message: 'Payment deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getCreditors,
    createCreditor,
    updateCreditor,
    deleteCreditor,
    getCreditorDetails,
    recordCreditorPayment,
    deleteCreditorPayment
};
