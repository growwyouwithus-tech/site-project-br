const mongoose = require('mongoose');
require('dotenv').config();
const Labour = require('./models/Labour');
const LabourPayment = require('./models/LabourPayment');
const LabourAttendance = require('./models/LabourAttendance');
const Contractor = require('./models/Contractor');
const ContractorPayment = require('./models/ContractorPayment');
const Vendor = require('./models/Vendor');
const VendorPayment = require('./models/VendorPayment');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    console.log('Connected. Fixing Labours...');
    const labours = await Labour.find();
    for (let l of labours) {
        const payments = await LabourPayment.find({ labourId: l._id });
        const atts = await LabourAttendance.find({ labourId: l._id });
        
        const earned = atts.reduce((sum, a) => sum + (a.status === 'present' ? (l.dailyWage || 0) : a.status === 'half-day' ? (l.dailyWage || 0)/2 : 0), 0);
        const paid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const deducted = payments.reduce((sum, p) => sum + (p.deduction || 0), 0);
        const advanced = payments.reduce((sum, p) => sum + (p.advance || 0), 0);
        
        l.pendingPayout = Math.max(0, earned - paid - deducted);
        l.advance = Math.max(0, advanced - deducted);
        await l.save();
        console.log(`Labour ${l.name}: earned ${earned}, paid ${paid}, deducted ${deducted}, advanced ${advanced}. Fixed pending: ${l.pendingPayout}, advance: ${l.advance}`);
    }

    console.log('Fixing Contractors...');
    const contractors = await Contractor.find();
    for (let c of contractors) {
        const payments = await ContractorPayment.find({ contractorId: c._id });
        const paid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const deducted = payments.reduce((sum, p) => sum + (p.deduction || 0), 0);
        const advanced = payments.reduce((sum, p) => sum + (p.advance || 0), 0);
        
        // We can't easily calculate contractor "earned" without checking all their tasks/attendance
        // But we can at least fix the advance balance
        c.advancePayment = Math.max(0, advanced - deducted);
        await c.save();
        console.log(`Contractor ${c.name}: advanced ${advanced}, deducted ${deducted}. Fixed advance: ${c.advancePayment}`);
    }

    console.log('Fixing Vendors...');
    const vendors = await Vendor.find();
    for (let v of vendors) {
        const payments = await VendorPayment.find({ vendorId: v._id });
        const deducted = payments.reduce((sum, p) => sum + (p.deduction || 0), 0);
        const advanced = payments.reduce((sum, p) => sum + (p.advance || 0), 0);
        
        v.advancePayment = Math.max(0, advanced - deducted);
        await v.save();
        console.log(`Vendor ${v.name}: advanced ${advanced}, deducted ${deducted}. Fixed advance: ${v.advancePayment}`);
    }

    process.exit(0);
});
