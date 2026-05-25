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
    projectAssignedAt: {
        type: Date
    },
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
    },
    projectHistory: [{
        projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
        name: { type: String },
        assignedAt: { type: Date },
        completedAt: { type: Date },
        distanceValue: { type: Number },
        distanceUnit: { type: String, enum: ['km', 'm'] },
        expensePerUnit: { type: Number },
        totalPaid: { type: Number, default: 0 },
        advancePayment: { type: Number, default: 0 },
        totalMachineRent: { type: Number, default: 0 }
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Contractor', contractorSchema);
