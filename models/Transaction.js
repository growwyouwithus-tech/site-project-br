const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    date: {
        type: Date,
        default: Date.now,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['credit', 'debit'], // credit = money in, debit = money out
        required: true
    },
    category: {
        type: String,
        enum: ['expense', 'capital', 'other', 'wallet_allocation', 'third_party_funds', 'salary_payment'],
        default: 'other'
    },
    paymentMode: {
        type: String,
        enum: ['cash', 'bank', 'upi', 'check', 'online'],
        default: 'cash'
    },
    description: {
        type: String,
        required: true
    },
    relatedId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'onModel' // Dynamic reference to Expense, VendorPayment, etc. if needed (optional for manual)
    },
    onModel: {
        type: String,
        enum: ['Expense', 'VendorPayment', 'LabourPayment', 'ContractorPayment', 'Project', 'User']
    },
    addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    bankId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BankDetail'
    },
    creditorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Creditor'
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Transaction', transactionSchema);
