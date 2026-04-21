const mongoose = require('mongoose');
require('dotenv').config();
const Transaction = require('./models/Transaction');
const User = require('./models/User');

const fixTransfers = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // 1. Find all manager_transfer debit transactions
        // These contain the recipientId in relatedId
        const debits = await Transaction.find({ 
            category: 'manager_transfer', 
            type: 'debit' 
        });

        console.log(`Found ${debits.length} debit transactions to check.`);

        let fixedCount = 0;

        for (const debit of debits) {
            const senderId = debit.addedBy;
            const recipientId = debit.relatedId;
            const amount = debit.amount;
            
            // Find the matching credit transaction that was incorrectly assigned to the sender
            // It will have the same amount, approx same time, and category 'manager_transfer'
            // In the old logic, it had addedBy: senderId and relatedId: senderId
            const startTime = new Date(debit.date.getTime() - 5000); // 5 seconds window
            const endTime = new Date(debit.date.getTime() + 5000);

            const credit = await Transaction.findOne({
                category: 'manager_transfer',
                type: 'credit',
                amount: amount,
                addedBy: senderId,
                relatedId: senderId,
                date: { $gte: startTime, $lte: endTime }
            });

            if (credit) {
                console.log(`Fixing credit transaction for amount ${amount} from ${senderId} to ${recipientId}`);
                credit.addedBy = recipientId;
                credit.relatedId = senderId;
                await credit.save();
                fixedCount++;
            }
        }

        console.log(`Successfully fixed ${fixedCount} credit transactions.`);
        process.exit(0);
    } catch (error) {
        console.error('Error fixing transfers:', error);
        process.exit(1);
    }
};

fixTransfers();
