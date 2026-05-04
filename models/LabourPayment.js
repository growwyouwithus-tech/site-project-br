/**
 * Labour Payment Model
 */

const mongoose = require('mongoose');

const labourPaymentSchema = new mongoose.Schema({
    labourId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Labour',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true // Paid by whom
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    deduction: {
        type: Number,
        default: 0,
        min: 0
    },
    advance: {
        type: Number,
        default: 0,
        min: 0
    },
    advanceRecovered: {
        type: Number,
        default: 0,
        min: 0
    },
    finalAmount: {
        type: Number,
        required: true
    },
    paymentMode: {
        type: String,
        enum: ['cash', 'bank', 'bank_transfer', 'upi', 'online', 'check', 'credit', 'other'],
        default: 'cash'
    },
    bankId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BankDetail'
    },
    creditorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Creditor'
    },
    remarks: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('LabourPayment', labourPaymentSchema);
