/**
 * Seed Admin Account
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

async function seedAdmin() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-site');
        console.log('Connected to database');

        let admin = await User.findOne({ role: 'admin' });

        if (admin) {
            console.log(`Found existing admin: ${admin.email}`);
            admin.email = 'ak.construction.hts@gmail.com';
            admin.password = 'Ankit@3004';
            await admin.save();
            console.log(`✅ Reset existing admin password. Login Credentials:`);
            console.log(`- Email / ID: ${admin.email}`);
            console.log(`- Password: Ankit@3004`);
        } else {
            console.log('No admin found, creating a new one...');
            admin = new User({
                name: 'Admin',
                email: 'ak.construction.hts@gmail.com',
                password: 'Ankit@3004',
                role: 'admin',
                phone: '1234567890'
            });
            await admin.save();
            console.log(`✅ Created new admin account. Login Credentials:`);
            console.log(`- Email / ID: ak.construction.hts@gmail.com`);
            console.log(`- Password: Ankit@3004`);
        }

    } catch (error) {
        console.error('Error seeding admin:', error);
    } finally {
        await mongoose.disconnect();
    }
}

seedAdmin();
