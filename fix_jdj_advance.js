
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function fixJdjAdvance() {
    try {
        console.log('🔗 Connecting to:', process.env.MONGODB_URI || process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const ContractorSchema = new mongoose.Schema({}, { strict: false });
        const Contractor = mongoose.model('Contractor', ContractorSchema);

        const result = await Contractor.updateOne(
            { name: /jdj/i },
            { $set: { advancePayment: 0 } }
        );

        if (result.modifiedCount > 0) {
            console.log('✅ Successfully reset jdj advance to 0');
        } else {
            console.log('ℹ️ No changes made (maybe already 0 or not found)');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixJdjAdvance();
