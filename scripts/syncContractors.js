
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function syncContractors() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const { Contractor, Machine } = require('../models');

        const contractors = await Contractor.find();
        const machines = await Machine.find();

        for (const c of contractors) {
            const contractorIdStr = c._id.toString();
            
            // 1. Calculate Machine Rent
            let totalMachineRent = 0;
            machines.forEach(m => {
                if (m.assignedToContractor?.toString() === contractorIdStr && m.status === 'in-use') {
                    const assignedAt = m.assignedAt ? new Date(m.assignedAt) : new Date();
                    const days = Math.max(1, Math.ceil((Date.now() - assignedAt.getTime()) / (1000 * 60 * 60 * 24)));
                    const rate = m.assignedRentalPerDay || m.perDayExpense || 0;
                    totalMachineRent += (days * rate);
                }
                if (m.assignmentHistory) {
                    m.assignmentHistory.forEach(h => {
                        if (h.assignedTo?.toString() === contractorIdStr && h.assignedModel === 'Contractor') {
                            totalMachineRent += (h.totalRent || 0);
                        }
                    });
                }
            });

            // 2. Calculate correct Pending
            const totalWorkAmount = (c.distanceValue || 0) * (c.expensePerUnit || 0);
            const totalPaid = c.totalPaid || 0;
            
            // Pending = Work - Paid - Rent
            let pending = totalWorkAmount - totalPaid - totalMachineRent;
            let advance = 0;

            if (pending < 0) {
                advance = Math.abs(pending);
                pending = 0;
            }

            console.log(`👤 Syncing ${c.name}: Work=${totalWorkAmount}, Paid=${totalPaid}, Rent=${totalMachineRent} -> Pending=${pending}, Advance=${advance}`);

            await Contractor.findByIdAndUpdate(c._id, {
                pendingAmount: pending,
                advancePayment: advance
            });
        }

        console.log('✅ All contractors synchronized successfully');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

syncContractors();
