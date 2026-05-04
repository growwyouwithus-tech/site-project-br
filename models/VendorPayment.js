const mongoose = require('mongoose');

const vendorPaymentSchema = new mongoose.Schema({
    vendorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor',
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    advance: {
        type: Number,
        default: 0
    },
    deduction: {
        type: Number,
        default: 0
    },
    advanceRecovered: {
        type: Number,
        default: 0
    },
    paymentMode: {
        type: String,
        enum: ['cash', 'upi', 'online', 'bank_transfer', 'bank', 'check', 'credit', 'other'],
        required: true
    },
    bankId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BankDetail'
    },
    creditorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Creditor'
    },
    date: {
        type: Date,
        default: Date.now
    },
    remarks: {
        type: String,
        trim: true
    },
    recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User' // Admin who recorded it
    },
    isAdvance: {
        type: Boolean,
        default: false
    },
    receiptUrl: {
        type: String // URL to uploaded receipt/slip
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('VendorPayment', vendorPaymentSchema);
