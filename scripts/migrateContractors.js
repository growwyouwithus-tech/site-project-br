const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Contractor = require('../models/Contractor');

dotenv.config();

const migrate = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const contractors = await Contractor.find({});
        console.log(`Found ${contractors.length} contractors to migrate...`);

        let count = 0;
        for (const contractor of contractors) {
            // Only migrate if activeAssignments is empty and they have an assigned project
            if (contractor.activeAssignments.length === 0 && contractor.assignedProjects && contractor.assignedProjects.length > 0) {
                // If they have multiple assignedProjects but no activeAssignments, we'll map the legacy fields to the FIRST assignedProject,
                // and push empty objects for the rest (assuming they were machine-only). 
                // But most likely, they only have 1 assignedProject right now.
                
                const legacyDistance = contractor.distanceValue || 0;
                const legacyUnit = contractor.distanceUnit || 'km';
                const legacyExpense = contractor.expensePerUnit || 0;
                const legacyTotalPaid = contractor.totalPaid || 0;
                const legacyAdvance = contractor.advancePayment || 0;
                const legacyAssignedAt = contractor.projectAssignedAt || contractor.createdAt;

                // Push the legacy data to the first project
                contractor.activeAssignments.push({
                    projectId: contractor.assignedProjects[0],
                    assignedAt: legacyAssignedAt,
                    distanceValue: legacyDistance,
                    distanceUnit: legacyUnit,
                    expensePerUnit: legacyExpense,
                    totalPaid: legacyTotalPaid,
                    advancePayment: legacyAdvance
                });

                // If they had any accidental extra assignedProjects, push them with 0 financials
                for (let i = 1; i < contractor.assignedProjects.length; i++) {
                    contractor.activeAssignments.push({
                        projectId: contractor.assignedProjects[i],
                        assignedAt: legacyAssignedAt,
                        distanceValue: 0,
                        distanceUnit: 'km',
                        expensePerUnit: 0,
                        totalPaid: 0,
                        advancePayment: 0
                    });
                }

                await contractor.save();
                count++;
            }
        }

        console.log(`Migration complete. Updated ${count} contractors.`);
        mongoose.disconnect();
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
};

migrate();
