const mongoose = require('mongoose');
const { Contractor, ContractorPayment } = require('./models');

mongoose.connect('mongodb://127.0.0.1:27017/site_management', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(async () => {
    const contractors = await Contractor.find();
    for (const c of contractors) {
        const payments = await ContractorPayment.find({ contractorId: c._id });
        console.log(`\nContractor: ${c.name}`);
        console.log(`Total Payments Count: ${payments.length}`);
        let sumAmount = 0;
        let sumAdvance = 0;
        payments.forEach(p => {
            console.log(` - Payment: amount=${p.amount}, advance=${p.advance}, isAdvance=${p.isAdvance}, date=${p.date}`);
            sumAmount += (p.amount || 0);
            sumAdvance += (p.advance || 0);
        });
        console.log(`Sum Amount: ${sumAmount}, Sum Advance: ${sumAdvance}`);
    }
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
