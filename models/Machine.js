const mongoose = require('mongoose');

const machineSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    model: {
        type: String,
        trim: true
    },
    plateNumber: {
        type: String,
        trim: true
    },
    category: {
        type: String,
        required: true,
        enum: ['big', 'lab', 'consumables', 'equipment']
    },
    quantity: {
        type: mongoose.Schema.Types.Mixed,
        default: 1
    },
    status: {
        type: String,
        enum: ['available', 'in-use', 'maintenance', 'returned'],
        default: 'available'
    },
    availableLocation: {
        type: String,
        trim: true,
        default: ''
    },
    ownershipType: {
        type: String,
        enum: ['own', 'rented'],
        default: 'own'
    },
    creditorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Creditor'
    },
    machineCategory: {
        type: String,
        trim: true
    },
    machinePhoto: {
        type: String,
        trim: true
    },
    perDayExpense: {
        type: Number,
        default: 0
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
    },
    assignments: [{
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project'
        },
        quantity: {
            type: Number,
            required: true
        },
        assignedAt: {
            type: Date,
            default: Date.now
        }
    }],
    assignedAsRental: {
        type: Boolean,
        default: false
    },
    assignedRentalPerDay: {
        type: Number,
        default: 0
    },
    rentalType: {
        type: String,
        enum: ['perDay', 'perHour'],
        default: 'perDay'
    },
    assignedRentalType: {
        type: String,
        enum: ['perDay', 'perHour'],
        default: 'perDay'
    },
    assignedAt: {
        type: Date
    },
    rentedAt: {
        type: Date
    },
    assignedToContractor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contractor'
    },
    returnedAt: {
        type: Date
    },
    totalRentPaid: {
        type: Number,
        default: 0
    },
    isRentPaused: {
        type: Boolean,
        default: false
    },
    rentPausedAt: {
        type: Date
    },
    rentPausedHistory: [{
        pausedAt: Date,
        resumedAt: Date,
        duration: Number // in hours
    }],
    maintenanceHistory: [{
        enteredAt: Date,
        completedAt: Date,
        cost: Number,
        description: String,
        remark: String
    }],
    assignmentHistory: [{
        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'assignmentHistory.assignedModel' // Dynamic reference
        },
        assignedModel: {
            type: String,
            enum: ['Project', 'Contractor']
        },
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project'
        },
        assignedAt: Date,
        returnedAt: Date,
        initialStatus: String, // 'available' when assigned? No, 'in-use'
        returnStatus: String, // 'returned'
        rentType: String, // 'perDay', 'perHour'
        rate: Number,
        totalRent: Number,
        durationMinutes: Number // Store precise duration
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Machine', machineSchema);
