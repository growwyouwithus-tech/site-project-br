const mongoose = require('mongoose');

const creditorPaymentSchema = new mongoose.Schema({
    creditorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Creditor',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    paymentMode: {
        type: String,
        enum: ['cash', 'online', 'check', 'bank', 'creditor'],
        default: 'cash'
    },
    remarks: {
        type: String,
        trim: true
    },
    slip: {
        type: String, // Cloudinary URL
        trim: true
    },
    bankId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BankDetail'
    },
    recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('CreditorPayment', creditorPaymentSchema);
