const mongoose = require('mongoose');
require('dotenv').config();
const Creditor = require('./models/Creditor');

const reverseCreditorLogic = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const creditors = await Creditor.find({});
        console.log(`Found ${creditors.length} creditors.`);

        for (const creditor of creditors) {
            // Reverse the balance sign
            creditor.currentBalance = creditor.currentBalance * -1;

            // Reverse the transaction types
            for (let i = 0; i < creditor.transactions.length; i++) {
                if (creditor.transactions[i].type === 'credit') {
                    creditor.transactions[i].type = 'debit';
                } else if (creditor.transactions[i].type === 'debit') {
                    creditor.transactions[i].type = 'credit';
                }
            }

            await creditor.save();
            console.log(`Updated creditor: ${creditor.name} | New Balance: ${creditor.currentBalance}`);
        }

        console.log('Migration complete.');
        process.exit(0);
    } catch (error) {
        console.error('Error migrating creditor logic:', error);
        process.exit(1);
    }
};

reverseCreditorLogic();
