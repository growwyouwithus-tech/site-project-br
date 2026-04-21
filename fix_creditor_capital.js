const mongoose = require('mongoose');
require('dotenv').config();
const Creditor = require('./models/Creditor');
const Transaction = require('./models/Transaction');

const fixCreditorCapital = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Find capital transactions with a creditorId
        const transactions = await Transaction.find({ category: 'capital', creditorId: { $ne: null } });
        console.log(`Found ${transactions.length} capital transactions with creditors.`);

        for (const t of transactions) {
            const creditor = await Creditor.findById(t.creditorId);
            if (creditor) {
                // Check if this transaction is already in the creditor's history
                const exists = creditor.transactions.some(ct => ct.refId && ct.refId.toString() === t._id.toString());
                if (!exists) {
                    creditor.transactions.push({
                        type: 'credit', // Credit means we owe them more
                        amount: t.amount,
                        date: t.date || t.createdAt,
                        description: t.description || 'Capital Provided',
                        refId: t._id,
                        refModel: 'Transaction'
                    });
                    await creditor.save();
                    console.log(`Added transaction ${t._id} to creditor ${creditor.name}`);
                } else {
                    console.log(`Transaction ${t._id} already exists for creditor ${creditor.name}`);
                }
            }
        }
        
        console.log('Fix complete.');
        process.exit(0);
    } catch (error) {
        console.error('Error fixing creditor capital:', error);
        process.exit(1);
    }
};

fixCreditorCapital();
