
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function addWalletBalance() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const { User } = require('../models');

        // Target Site Manager (from screenshot email: fjfj@gmail.com)
        const user = await User.findOne({ email: 'fjfj@gmail.com' });
        
        if (!user) {
            console.log('❌ User not found');
            process.exit(1);
        }

        user.walletBalance = 50000;
        await user.save();

        console.log(`✅ Updated ${user.name}'s wallet balance to ₹50,000`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

addWalletBalance();
