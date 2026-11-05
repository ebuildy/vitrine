import { Redis } from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { measureCacheStore } from './metrics.ts';
import type { CacheStats } from './metrics.ts';
import { getSettings } from './settings.ts';
import type { CacheStoreSettings } from './settings.ts';

export interface Entry {
	data: unknown;
	loadedAt: number;
}

export interface CacheStore {
	get: (key: string) => Promise<Entry | undefined>;
	set: (key: string, entry: Entry) => Promise<void>;
	/** How many entries the store holds, and their size in bytes, for the metrics. */
	stats: () => Promise<CacheStats>;
}

let store: CacheStore | undefined;

export function getCacheStore(): CacheStore {
	if (!store) {
		const { cacheStore } = getSettings();
		store = createCacheStore(cacheStore);
		measureCacheStore(cacheStore.type, store.stats);
	}
	return store;
}

function createCacheStore(settings: CacheStoreSettings): CacheStore {
	switch (settings.type) {
		case 'memory':
			return memoryStore();
		case 'files':
			return filesStore(settings.directory);
		case 'redis':
			return redisStore(settings.url, settings.keyPrefix);
	}
}

function memoryStore(): CacheStore {
	const entries = new Map<string, Entry>();
	return {
		get: async (key) => entries.get(key),
		set: async (key, entry) => {
			entries.set(key, entry);
		},
		stats: async () => ({ entries: entries.size, bytes: [...entries.values()].reduce((total, entry) => total + JSON.stringify(entry).length, 0) }),
	};
}

function filesStore(directory: string): CacheStore {
	// Keys hold whatever a Route's parameters do, so they are hashed into safe file names.
	const pathOf = (key: string) => join(directory, `${createHash('sha256').update(key).digest('hex')}.json`);
	return {
		get: async (key) => {
			const content = await readFile(pathOf(key), 'utf8').catch((error) => {
				if (error.code === 'ENOENT') return undefined;
				throw error;
			});
			return content === undefined ? undefined : JSON.parse(content);
		},
		set: async (key, entry) => {
			await mkdir(directory, { recursive: true });
			// Renaming into place means a crash never leaves a half-written file.
			const temporaryPath = `${pathOf(key)}.${randomUUID()}.tmp`;
			await writeFile(temporaryPath, JSON.stringify(entry));
			await rename(temporaryPath, pathOf(key));
		},
		stats: async () => {
			// Entries only: a temporary file is a write in progress, and a missing directory is a cache not written yet.
			const names = (await readdir(directory).catch(() => [])).filter((name) => name.endsWith('.json'));
			// An entry replaced or removed between listing and reading is left out.
			const sizes = await Promise.all(names.map((name) => stat(join(directory, name)).then(({ size }) => size, () => undefined)));
			const present = sizes.filter((size) => size !== undefined);
			return { entries: present.length, bytes: present.reduce((total, size) => total + size, 0) };
		},
	};
}

function redisStore(url: string, keyPrefix: string): CacheStore {
	const redis = new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 1_000 });
	// The content cache logs every read and write that fails, which says more than the connection errors do.
	redis.on('error', () => {});
	return {
		get: async (key) => {
			const content = await redis.get(`${keyPrefix}${key}`);
			return content === null ? undefined : JSON.parse(content);
		},
		set: async (key, entry) => {
			await redis.set(`${keyPrefix}${key}`, JSON.stringify(entry));
		},
		stats: async () => {
			let entries = 0;
			// SCAN, not KEYS, which would block a Redis the replicas share. No size: that takes a command per key.
			const pattern = `${keyPrefix.replace(/[\\*?[\]]/g, '\\$&')}*`;
			for await (const keys of redis.scanStream({ match: pattern, count: 500 })) entries += (keys as string[]).length;
			return { entries };
		},
	};
}
