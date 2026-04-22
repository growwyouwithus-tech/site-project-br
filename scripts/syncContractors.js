const mongoose = require('mongoose');
const Contractor = require('../models/Contractor');
const ContractorPayment = require('../models/ContractorPayment');
const Machine = require('../models/Machine');
require('dotenv').config();

const syncContractors = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const contractors = await Contractor.find();
        console.log(`Found ${contractors.length} contractors to sync`);

        for (const contractor of contractors) {
            console.log(`Syncing ${contractor.name}...`);

            // 1. Calculate Work Cost
            const totalWorkCost = (contractor.distanceValue || 0) * (contractor.expensePerUnit || 0);

            // 2. Calculate Machine Rental Cost
            // We need to look at all machines that were assigned to this contractor
            const machines = await Machine.find({
                'assignmentHistory.assignedTo': contractor._id,
                'assignmentHistory.assignedModel': 'Contractor'
            });

            let totalRentalCost = 0;
            machines.forEach(m => {
                m.assignmentHistory.forEach(history => {
                    if (history.assignedTo.toString() === contractor._id.toString() && history.assignedModel === 'Contractor') {
                        totalRentalCost += (history.totalRent || 0);
                    }
                });
            });

            // 3. Calculate Total Paid
            const payments = await ContractorPayment.find({ contractorId: contractor._id });
            const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

            // 4. Update Contractor
            // Net = Earnings (Work) - Deductions (Rent + Paid)
            const netBalance = totalWorkCost - (totalRentalCost + totalPaid);
            
            contractor.totalPaid = totalPaid;
            contractor.pendingAmount = netBalance > 0 ? netBalance : 0;
            contractor.advancePayment = netBalance < 0 ? Math.abs(netBalance) : 0;

            await contractor.save();
            console.log(`  - Work Cost: ₹${totalWorkCost}`);
            console.log(`  - Rental Cost: ₹${totalRentalCost}`);
            console.log(`  - Total Paid: ₹${totalPaid}`);
            console.log(`  - New Pending: ₹${contractor.pendingAmount}`);
        }

        console.log('Sync completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Sync failed:', error);
        process.exit(1);
    }
};

syncContractors();
