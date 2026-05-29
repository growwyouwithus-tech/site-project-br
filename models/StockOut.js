/**
 * Stock Out Model
 */

const mongoose = require('mongoose');

const stockOutSchema = new mongoose.Schema({
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    materialName: {
        type: String,
        required: true,
        trim: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 0
    },
    unit: {
        type: String,
        required: true
    },
    usedFor: {
        type: String,
        required: true, // e.g., "Block A", "Road work", etc.
        trim: true
    },
    machineId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Machine'
    },
    date: {
        type: Date,
        default: Date.now
    },
    remarks: {
        type: String,
        trim: true
    },
    photos: [{
        type: String, // Cloudinary URLs
        trim: true
    }],
    recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('StockOut', stockOutSchema);
