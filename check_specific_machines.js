
const mongoose = require('mongoose');
const { Machine } = require('./models');
require('dotenv').config();

async function check() {
    await mongoose.connect(process.env.MONGODB_URI);
    const machines = await Machine.find({ plateNumber: { $in: ['9U9UH9U', 'KUUHUH'] } });
    console.log(JSON.stringify(machines, null, 2));
    process.exit();
}

check();
