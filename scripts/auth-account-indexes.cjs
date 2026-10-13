// Additive only. Defaults to dry-run, never renames members, replaces passwords, merges accounts,
// drops indexes/collections, or rewrites references. Run before enabling new public registration.
require('dotenv').config();
const mongoose = require('mongoose');
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const expectedDatabase = [...args].find((a) => a.startsWith('--database='))?.slice('--database='.length);
const indexes = [
	[
		'members',
		{ memberNick: 1 },
		{ name: 'memberNick_ci_unique', unique: true, collation: { locale: 'en', strength: 2 } },
	],
	['authIdentities', { provider: 1, providerUserId: 1 }, { unique: true }],
	['authIdentities', { memberId: 1, provider: 1 }, { unique: true }],
	['authIdentities', { memberId: 1 }, {}],
	['authSecurity', { memberId: 1 }, { unique: true }],
	[
		'authSecurity',
		{ recoveryEmail: 1 },
		{ unique: true, partialFilterExpression: { recoveryEmail: { $type: 'string' } } },
	],
	['authTransactions', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
	['authEvents', { memberId: 1 }, {}],
	['authEvents', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
	['refreshSessions', { memberId: 1, revokedAt: 1, expiresAt: 1 }, {}],
	['refreshSessions', { absoluteExpiresAt: 1 }, { expireAfterSeconds: 0 }],
	['authRateLimits', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
];
(async () => {
	const uri = process.env.NODE_ENV === 'production' ? process.env.MONGO_PROD : process.env.MONGO_DEV;
	if (!uri) throw Error('Database is not configured');
	await mongoose.connect(uri, { autoIndex: false });
	try {
		const db = mongoose.connection;
		if (apply && (!expectedDatabase || db.name !== expectedDatabase))
			throw Error('Applying indexes requires --database=<exact connected database name>');
		const members = db.collection('members');
		const conflicts = await members
			.aggregate(
				[
					{ $group: { _id: '$memberNick', count: { $sum: 1 } } },
					{ $match: { count: { $gt: 1 } } },
					{ $count: 'total' },
				],
				{ collation: { locale: 'en', strength: 2 } },
			)
			.toArray();
		const legacy = await members.countDocuments({ memberNick: { $not: /^[a-zA-Z0-9_.-]{3,30}$/ } });
		const stats = await members
			.aggregate([
				{
					$group: {
						_id: null,
						members: { $sum: 1 },
						bcrypt: {
							$sum: {
								$cond: [{ $regexMatch: { input: { $ifNull: ['$memberPassword', ''] }, regex: '^\\$2[aby]\\$' } }, 1, 0],
							},
						},
						argon2: {
							$sum: {
								$cond: [
									{ $regexMatch: { input: { $ifNull: ['$memberPassword', ''] }, regex: '^\\$argon2id\\$' } },
									1,
									0,
								],
							},
						},
					},
				},
			])
			.toArray();
		console.log(
			JSON.stringify(
				{
					mode: apply ? 'apply' : 'dry-run',
					counts: stats[0] ?? {},
					caseInsensitiveConflictGroups: conflicts[0]?.total ?? 0,
					grandfatheredNames: legacy,
					indexes: indexes.map(([collection, key, options]) => ({ collection, key, ...options })),
				},
				null,
				2,
			),
		);
		if (conflicts.length)
			throw Error('Username conflicts must be reviewed manually; no member records or indexes were changed');
		if (apply)
			for (const [collection, key, options] of indexes) await db.collection(collection).createIndex(key, options);
		console.log(
			apply
				? 'Additive authentication indexes verified. All member records and IDs preserved.'
				: 'Dry-run complete. No records or indexes changed.',
		);
	} finally {
		await mongoose.disconnect();
	}
})().catch((error) => {
	// Do not print driver errors containing connection credentials.
	console.error(
		error.message?.startsWith('Username conflicts') || error.message?.startsWith('Applying indexes')
			? error.message
			: 'Authentication index preparation failed. Inspect private database configuration and index compatibility.',
	);
	process.exitCode = 1;
});
