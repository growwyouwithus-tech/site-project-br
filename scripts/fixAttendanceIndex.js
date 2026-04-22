const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' });

const fixIndex = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/site-management');
        console.log('Connected successfully.');

        const db = mongoose.connection.db;
        const collection = db.collection('attendances');

        console.log('Fetching current indexes...');
        const indexes = await collection.indexes();
        console.log('Current indexes:', JSON.stringify(indexes, null, 2));

        // Find and drop the first unique index
        const targetIndex1 = indexes.find(idx => 
            idx.name === 'userId_1_date_1_projectId_1' ||
            (idx.key && idx.key.userId === 1 && idx.key.date === 1 && idx.key.projectId === 1 && idx.unique)
        );

        if (targetIndex1) {
            console.log(`Dropping unique index: ${targetIndex1.name}`);
            await collection.dropIndex(targetIndex1.name);
            console.log('Index 1 dropped successfully.');
        }

        // Find and drop the second unique index (different order)
        const targetIndex2 = indexes.find(idx => 
            idx.name === 'userId_1_projectId_1_date_1' ||
            (idx.key && idx.key.userId === 1 && idx.key.projectId === 1 && idx.key.date === 1 && idx.unique)
        );

        if (targetIndex2) {
            console.log(`Dropping unique index: ${targetIndex2.name}`);
            await collection.dropIndex(targetIndex2.name);
            console.log('Index 2 dropped successfully.');
        }

        console.log('Done.');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

fixIndex();
