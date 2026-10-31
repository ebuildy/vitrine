import { Redis } from 'ioredis';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A database of its own, as every test empties it. compose.yaml provides the server.
export const REDIS_URL = 'redis://127.0.0.1:6379/15';
process.env.VITRINE_TEST_REDIS_URL = REDIS_URL;

export interface TestCacheStore {
	name: string;
	survivesRestart: boolean;
	/** Returns the Settings of an empty store, so that no test sees what another one cached. */
	empty: () => Promise<Record<string, unknown>>;
}

export const cacheStores: TestCacheStore[] = [
	{
		name: 'memory',
		survivesRestart: false,
		empty: async () => ({ type: 'memory' }),
	},
	{
		name: 'local files',
		survivesRestart: true,
		empty: async () => ({ type: 'files', directory: join(mkdtempSync(join(tmpdir(), 'vitrine-cache-')), 'cache') }),
	},
	{
		name: 'Redis',
		survivesRestart: true,
		empty: async () => {
			const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 0 });
			await redis.flushdb();
			redis.disconnect();
			return { type: 'redis', urlEnv: 'VITRINE_TEST_REDIS_URL' };
		},
	},
];
