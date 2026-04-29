
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function fixCement() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const { Stock, Expense, Project, User } = require('../models');

        // Find the latest credit cement entry
        const cement = await Stock.findOne({ 
            materialName: /cement/i, 
            paymentStatus: 'credit' 
        }).sort({ createdAt: -1 });

        if (cement) {
            console.log(`Found Cement entry: ₹${cement.totalPrice}`);
            
            // 1. Mark as paid
            cement.paymentStatus = 'paid';
            await cement.save();

            // 2. Create Expense
            const expense = new Expense({
                projectId: cement.projectId,
                name: 'Material Purchase: CEMENT',
                amount: cement.totalPrice,
                category: 'material',
                remarks: 'Auto-generated (Fix). ' + (cement.remarks || ''),
                receipt: cement.photo,
                addedBy: cement.addedBy
            });
            await expense.save();

            // 3. Update Project Total
            await Project.findByIdAndUpdate(cement.projectId, { $inc: { expenses: cement.totalPrice } });

            // 4. Deduct from User Wallet
            const user = await User.findById(cement.addedBy);
            if (user) {
                user.walletBalance -= cement.totalPrice;
                await user.save();
                console.log(`✅ Deducted ₹${cement.totalPrice} from ${user.name}'s wallet`);
            }

            console.log('✅ Cement fixed and added to Expenses');
        } else {
            console.log('❌ No credit cement entry found');
        }
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixCement();
