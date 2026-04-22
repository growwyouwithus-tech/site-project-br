const mongoose = require('mongoose');

const contractorSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    mobile: {
        type: String,
        required: true,
        trim: true
    },
    address: {
        type: String,
        required: true
    },
    distanceValue: {
        type: Number,
        required: true
    },
    distanceUnit: {
        type: String,
        enum: ['km', 'm'],
        default: 'km'
    },
    expensePerUnit: {
        type: Number,
        required: true
    },
    assignedProjects: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
    }],
    status: {
        type: String,
        enum: ['pending', 'complete', 'active', 'inactive'],
        default: 'pending'
    },
    pendingAmount: {
        type: Number,
        default: 0
    },
    totalPaid: {
        type: Number,
        default: 0
    },
    advancePayment: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Contractor', contractorSchema);
