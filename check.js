const mongoose = require('mongoose');

async function run() {
    try {
        await mongoose.connect('mongodb://127.0.0.1:27017/site-management');
        const db = mongoose.connection.db;

        const contractors = await db.collection('contractors').find({ name: /parvesh/i }).toArray();
        console.log('Contractor Parvesh:', contractors);

        const users = await db.collection('users').find({ role: 'sitemanager' }).toArray();
        console.log('Site Managers:', users.map(u => ({ email: u.email, assignedSites: u.assignedSites })));

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
run();
