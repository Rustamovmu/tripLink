import { Module } from '@nestjs/common';
import { InjectConnection, MongooseModule, MongooseModuleOptions } from '@nestjs/mongoose';
import { Connection, STATES } from 'mongoose';

export function getDatabaseOptions(env: NodeJS.ProcessEnv = process.env): MongooseModuleOptions {
	if (env.JEST_WORKER_ID && env.NODE_ENV !== 'test') {
		throw new Error('Database tests require NODE_ENV=test');
	}

	// Integration suites replace MONGO_DEV with a uniquely named disposable database.
	const variable = env.NODE_ENV === 'test' ? 'MONGO_DEV' : 'MONGO_PROD';
	const uri = env[variable]?.trim();
	if (!uri) throw new Error(`${variable} is required for the database connection`);
	return { uri };
}

@Module({
	imports: [
		MongooseModule.forRootAsync({
			useFactory: () => getDatabaseOptions(),
		}),
	],
	exports: [MongooseModule],
})
export class DatabaseModule {
	constructor(@InjectConnection() private readonly connection: Connection) {
		if (this.connection.readyState === STATES.connected) {
			console.log(`Database connected: ${this.connection.name}`);
		} else {
			console.error('Database connection failed');
		}
	}
}
