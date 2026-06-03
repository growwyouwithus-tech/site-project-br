const mongoose = require('mongoose');
require('dotenv').config();
const Attendance = require('./models/Attendance');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const all = await Attendance.find().populate('userId', 'name').sort('-date').lean();
    console.log('Total records:', all.length);
    all.forEach(a => console.log(a.userId?.name, '|', a.date, '|', new Date(a.date).toDateString()));
    mongoose.disconnect();
});
