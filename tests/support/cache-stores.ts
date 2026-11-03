import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// compose.yaml provides the server, which every worktree shares.
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
		// A prefix no other test, nor another worktree's run, has written under. The server evicts old keys.
		empty: async () => ({ type: 'redis', urlEnv: 'VITRINE_TEST_REDIS_URL', keyPrefix: `vitrine-test:${randomUUID()}:` }),
	},
];
