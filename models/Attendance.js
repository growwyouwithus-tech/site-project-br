const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    date: {
        type: String,
        required: true
    },
    time: {
        type: Date,
        default: Date.now
    },
    photo: {
        type: String,
        required: [true, 'Selfie is required for attendance']
    },
    remarks: {
        type: String
    }
}, {
    timestamps: true
});

// Index for faster queries
attendanceSchema.index({ userId: 1, date: -1 });
attendanceSchema.index({ projectId: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
