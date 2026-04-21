/**
 * Labour Model
 */

const mongoose = require('mongoose');

const labourSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Labour name is required'],
        trim: true
    },
    phone: {
        type: String,
        required: [true, 'Phone is required'],
        trim: true
    },
    dailyWage: {
        type: Number,
        required: [true, 'Daily wage is required'],
        min: 0
    },
    designation: {
        type: String,
        required: [true, 'Designation is required'],
        trim: true
    },
    assignedSite: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
    },
    enrolledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    contractorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contractor',
        default: null
    },
    active: {
        type: Boolean,
        default: true
    },
    pendingPayout: {
        type: Number,
        default: 0
    },
    advance: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Add indexes for frequent queries
labourSchema.index({ active: 1 });
labourSchema.index({ assignedSite: 1 });

module.exports = mongoose.model('Labour', labourSchema);
