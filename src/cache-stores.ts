import { Redis } from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getSettings } from './settings.ts';
import type { CacheStoreSettings } from './settings.ts';

export interface Entry {
	data: unknown;
	loadedAt: number;
}

export interface CacheStore {
	get: (key: string) => Promise<Entry | undefined>;
	set: (key: string, entry: Entry) => Promise<void>;
}

let store: CacheStore | undefined;

export function getCacheStore(): CacheStore {
	store ??= createCacheStore(getSettings().cacheStore);
	return store;
}

function createCacheStore(settings: CacheStoreSettings): CacheStore {
	switch (settings.type) {
		case 'memory':
			return memoryStore();
		case 'files':
			return filesStore(settings.directory);
		case 'redis':
			return redisStore(settings.url);
	}
}

function memoryStore(): CacheStore {
	const entries = new Map<string, Entry>();
	return {
		get: async (key) => entries.get(key),
		set: async (key, entry) => {
			entries.set(key, entry);
		},
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
	};
}

function redisStore(url: string): CacheStore {
	const redis = new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 1_000 });
	// The content cache logs every read and write that fails, which says more than the connection errors do.
	redis.on('error', () => {});
	return {
		get: async (key) => {
			const content = await redis.get(`vitrine:${key}`);
			return content === null ? undefined : JSON.parse(content);
		},
		set: async (key, entry) => {
			await redis.set(`vitrine:${key}`, JSON.stringify(entry));
		},
	};
}
