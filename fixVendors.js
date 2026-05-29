const mongoose = require('mongoose');
const Vendor = require('./models/Vendor');
const Stock = require('./models/Stock');
const VendorPayment = require('./models/VendorPayment');
require('dotenv').config({ path: './.env' });

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    console.log('Connected to DB');
    const vendors = await Vendor.find();
    let updated = 0;
    
    for (const v of vendors) {
        const stocks = await Stock.find({ vendorId: v._id }).sort('createdAt');
        const payments = await VendorPayment.find({ vendorId: v._id }).sort('date');
        
        const ledger = [];
        stocks.forEach(s => ledger.push({ type: 'stock', date: s.createdAt, amount: s.totalPrice || 0 }));
        payments.forEach(p => ledger.push({ 
            type: 'payment', 
            date: p.date, 
            paid: p.amount || 0, 
            deduction: p.deduction || 0,
            advanceRecovered: p.advanceRecovered || 0 
        }));
        
        ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        let pending = 0;
        let advance = 0;
        let totalSupplied = 0;
        
        for (const entry of ledger) {
            if (entry.type === 'stock') {
                pending += entry.amount;
                totalSupplied += entry.amount;
            } else if (entry.type === 'payment') {
                const reduction = entry.paid + entry.deduction + entry.advanceRecovered;
                pending -= reduction;
                advance -= entry.advanceRecovered;
                if (pending < 0) {
                    advance += Math.abs(pending);
                    pending = 0;
                }
                advance = Math.max(0, advance);
            }
        }
        
        v.totalSupplied = totalSupplied;
        v.pendingAmount = pending;
        v.advancePayment = advance;
        await v.save();
        updated++;
    }
    
    console.log('Total vendors fixed: ' + updated);
    process.exit(0);
}).catch(console.error);
