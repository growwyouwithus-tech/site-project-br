const mongoose = require('mongoose');

async function run() {
    try {
        await mongoose.connect('mongodb://127.0.0.1:27017/site-management');
        const db = mongoose.connection.db;
        const contractors = await db.collection('contractors').find({ name: /arun/i }).toArray();
        require('fs').writeFileSync('arun_debug.json', JSON.stringify(contractors, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
run();
