const mongoose = require('mongoose');

const contractorPaymentSchema = new mongoose.Schema({
    contractorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contractor',
        required: true
    },
    contractorName: {
        type: String,
        required: true
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
    },
    paidBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    date: {
        type: Date,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    advance: {
        type: Number,
        default: 0
    },
    deduction: {
        type: Number,
        default: 0
    },
    paymentMode: {
        type: String,
        enum: ['cash', 'online', 'upi', 'bank_transfer', 'bank', 'check', 'credit', 'other'],
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
    remark: {
        type: String,
        default: ''
    },
    machineRent: {
        type: Number,
        default: 0
    },
    isAdvance: {
        type: Boolean,
        default: false
    },
    receiptUrl: {
        type: String
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('ContractorPayment', contractorPaymentSchema);
