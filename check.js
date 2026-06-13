const mongoose = require('mongoose');
const Machine = require('./models/Machine');
require('dotenv').config({ path: './.env' });

async function checkMaintenance() {
    await mongoose.connect(process.env.MONGODB_URI);
    const machines = await Machine.find({ name: /troli/i });
    console.log('Found trolis:', machines.length);
    for (let m of machines) {
        console.log(`Machine ${m.name}: Qty ${m.quantity}, Maintenance Qty ${m.maintenanceQuantity}`);
    }
    process.exit(0);
}

checkMaintenance();
