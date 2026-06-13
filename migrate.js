const mongoose = require('mongoose');
const Machine = require('./models/Machine');
require('dotenv').config({ path: './.env' });

async function migrateMaintenance() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const machines = await Machine.find({ 
        category: { $in: ['lab', 'equipment'] },
        status: 'maintenance'
    });

    console.log(`Found ${machines.length} bulk machines stuck in old 'maintenance' status.`);

    for (const m of machines) {
        console.log(`Migrating ${m.name} (Qty: ${m.quantity})...`);
        m.maintenanceQuantity = m.quantity;
        m.status = 'available'; // Base status is available, maintenanceQty represents the broken ones

        m.maintenanceHistory = m.maintenanceHistory || [];
        m.maintenanceHistory.push({
            enteredAt: m.createdAt || new Date(),
            description: 'Migrated to new Partial Maintenance system'
        });

        await m.save();
        console.log(`Migrated ${m.name} successfully.`);
    }

    console.log('Migration complete!');
    process.exit(0);
}

migrateMaintenance();
