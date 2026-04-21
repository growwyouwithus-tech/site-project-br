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
        const { CreditorPayment, BankDetail } = require('../models');

        // Check for Source Creditor (Inter-Creditor Transfer)
        if (sourceCreditorId && sourceCreditorId !== '') {
            const sourceCreditor = await Creditor.findById(sourceCreditorId);
            if (!sourceCreditor) {
                return res.status(404).json({ success: false, error: 'Source Creditor not found' });
            }

            // Create Payment Record
            const payment = new CreditorPayment({
                creditorId, // Target
                amount: paidAmount,
                date: date || Date.now(),
                paymentMode: 'creditor', // Explicitly mark as creditor transfer
                remarks: `Transfer from ${sourceCreditor.name}: ${remarks || ''}`,
                recordedBy: userId
            });
            await payment.save();

            // 1. Update Source Creditor (DEBIT transaction - Giving funds out of their wallet - Balance DECREASES)
            // User requested wallet logic: Creditor giving money = Minus
            sourceCreditor.currentBalance -= paidAmount;
            sourceCreditor.transactions.push({
                type: 'debit',
                amount: paidAmount,
                date: date || new Date(),
                description: `used for paying ${creditor.name}`,
                refId: payment._id,
                refModel: 'CreditorPayment'
            });
            await sourceCreditor.save();

            // 2. Update Target Creditor (CREDIT transaction - Receiving funds into their wallet - Balance INCREASES)
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

module.exports = {
    getCreditors,
    createCreditor,
    updateCreditor,
    deleteCreditor,
    getCreditorDetails,
    recordCreditorPayment
};
