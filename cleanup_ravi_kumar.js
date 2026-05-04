const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const { Contractor } = require('./models');

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('Connected to MongoDB Atlas');
        
        const res = await Contractor.updateOne(
            { name: /ravi kumar/i }, 
            { $set: { advancePayment: 0, pendingAmount: 0 } }
        );
        
        console.log('Update result:', res);
        process.exit(0);
    })
    .catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });
