const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const { Contractor, ContractorPayment } = require('./models');

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('Connected to MongoDB Atlas');
        
        const contractorName = 'ravi kumar';
        const contractor = await Contractor.findOne({ name: new RegExp(contractorName, 'i') });
        
        if (!contractor) {
            console.log('Contractor not found');
            process.exit(1);
        }
        
        console.log(`Found contractor: ${contractor.name} (${contractor._id})`);
        
        // Find latest payment
        const payments = await ContractorPayment.find({ contractorId: contractor._id }).sort({ date: -1 });
        
        if (payments.length > 0) {
            const p = payments[0];
            const oldRent = p.machineRent || 0;
            p.machineRent = 50854;
            await p.save();
            console.log(`Updated payment ${p._id}: machineRent changed from ${oldRent} to ${p.machineRent}`);
        } else {
            console.log('No payments found for this contractor');
        }
        
        process.exit(0);
    })
    .catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });
