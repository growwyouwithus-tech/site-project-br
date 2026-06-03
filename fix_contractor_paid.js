const mongoose = require('mongoose');
const { Contractor, ContractorPayment } = require('./models');

mongoose.connect('mongodb://127.0.0.1:27017/site_management', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(async () => {
    console.log('Connected to DB');
    const contractors = await Contractor.find();
    for (const c of contractors) {
        const payments = await ContractorPayment.find({ contractorId: c._id });
        const total = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        c.totalPaid = total;
        await c.save();
        console.log(`Updated contractor ${c.name} totalPaid to ${total}`);
    }
    console.log('Done');
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
