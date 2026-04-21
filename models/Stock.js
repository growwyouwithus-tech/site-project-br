/**
 * Stock Model
 */

const mongoose = require('mongoose');

const stockSchema = new mongoose.Schema({
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: [true, 'Project is required']
    },
    vendorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor',
        required: [true, 'Vendor is required']
    },
    materialName: {
        type: String,
        required: [true, 'Material name is required'],
        trim: true
    },
    unit: {
        type: String,
        required: [true, 'Unit is required'],
        enum: ['kg', 'ltr', 'bags', 'pcs', 'meter', 'box', 'ton', 'ft', 'piece', 'bundle'],
        default: 'kg'
    },
    quantity: {
        type: Number,
        required: [true, 'Quantity is required'],
        min: 0
    },
    consumed: {
        type: Number,
        default: 0,
        min: 0
    },
    unitPrice: {
        type: Number,
        required: [true, 'Unit price is required'],
        min: 0
    },
    totalPrice: {
        type: Number,
        required: true,
        min: 0
    },
    photo: {
        type: String,
        trim: true
    },
    photos: [{
        type: String,
        trim: true
    }],
    remarks: {
        type: String,
        trim: true
    },
    vehicleNumber: {
        type: String,
        trim: true
    },
    addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    paymentStatus: {
        type: String,
        enum: ['credit', 'paid'],
        default: 'credit'
    }
}, {
    timestamps: true
});

stockSchema.index({ projectId: 1, createdAt: -1 });
stockSchema.index({ vendorId: 1 });

module.exports = mongoose.model('Stock', stockSchema);
