// Additive index setup only; never drops collections/indexes or modifies member records.
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
	const uri = process.env.NODE_ENV === 'production' ? process.env.MONGO_PROD : process.env.MONGO_DEV;
	if (!uri) throw new Error('Database connection is not configured');
	await mongoose.connect(uri, { autoIndex: false });
	try {
		await mongoose.connection.collection('refreshSessions').createIndex({ memberId: 1, revokedAt: 1, expiresAt: 1 });
		await mongoose.connection
			.collection('refreshSessions')
			.createIndex({ absoluteExpiresAt: 1 }, { expireAfterSeconds: 0 });
		await mongoose.connection.collection('authRateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
		console.log('Authentication indexes created. Existing member records were preserved.');
	} finally {
		await mongoose.disconnect();
	}
})().catch(() => {
	console.error('Authentication index setup failed. Check private database configuration.');
	process.exitCode = 1;
});
