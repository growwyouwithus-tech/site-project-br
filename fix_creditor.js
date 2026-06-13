const mongoose = require('mongoose');
const Creditor = require('./models/Creditor');
require('dotenv').config({ path: './.env' });

async function fixCreditor() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const ravi = await Creditor.findOne({ name: /ravi/i });
    if (ravi) {
        let changed = false;
        // Fix transactions
        ravi.transactions.forEach(t => {
            if (t.type === 'credit' && t.description && t.description.includes('Maintenance')) {
                t.type = 'debit';
                t.paymentMode = 'debit';
                ravi.currentBalance -= (t.amount * 2); // Reverse the + and apply the -
                changed = true;
            }
        });
        if (changed) {
            await ravi.save();
            console.log(`Fixed ravi's balance to ${ravi.currentBalance}`);
        } else {
            console.log("No maintenance transaction found for ravi to fix.");
        }
    } else {
        console.log("Ravi not found");
    }

    process.exit(0);
}

fixCreditor();
