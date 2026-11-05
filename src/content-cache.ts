import { getCacheStore } from './cache-stores.ts';
import type { Entry } from './cache-stores.ts';
import { countCacheRead, countCacheWriteError, countSourceCacheLookup } from './metrics.ts';
import type { SourceType } from './metrics.ts';
import { getSettings } from './settings.ts';

export const SOURCE_TIMEOUT_MS = 10_000;
const CACHE_STORE_TIMEOUT_MS = 1_000;

/** A Source that is up answering it cannot give this content, which Stale content must not stand in for. */
export class ContentUnavailableError extends Error {}

export type CachedContent<T> = { data: T; stale: boolean; error?: undefined } | { data?: undefined; stale?: undefined; error: Error };

/** Reads a Source, and is told through the signal when it has counted as down. */
export type Loader<T> = (signal: AbortSignal) => Promise<T>;

const inFlightReads = new Map<string, Promise<CachedContent<unknown>>>();

export async function readThrough<T>(source: SourceType, key: string, allowedAgeMs: number, loader: Loader<T>): Promise<CachedContent<T>> {
	return shared(key, () => readStoreThenSource(source, key, allowedAgeMs, loader));
}

function shared<T>(key: string, start: () => Promise<CachedContent<T>>): Promise<CachedContent<T>> {
	let read = inFlightReads.get(key);
	if (!read) {
		read = start().finally(() => inFlightReads.delete(key));
		inFlightReads.set(key, read);
	}
	return read as Promise<CachedContent<T>>;
}

/** Reads a Source the way it is set up to be read, where an allowed age of zero leaves the cache out. */
export function readSource<T>({ type, allowedAgeMinutes }: { type: SourceType; allowedAgeMinutes: number }, key: string, loader: Loader<T>): Promise<CachedContent<T>> {
	if (allowedAgeMinutes !== 0) return readThrough(type, key, allowedAgeMinutes * 60_000, loader);
	return shared(key, () => {
		countSourceCacheLookup(type, 'miss');
		return readUncached(key, loader);
	});
}

/** Reads a Source with the cache left out, so it never stores or falls back on anything. */
export async function readUncached<T>(key: string, loader: Loader<T>): Promise<CachedContent<T>> {
	try {
		return { data: await withTimeout(SOURCE_TIMEOUT_MS, loader), stale: false };
	} catch (error) {
		console.error(`Could not load "${key}":`, error);
		return { error: error instanceof Error ? error : new Error(String(error)) };
	}
}

async function readStoreThenSource<T>(source: SourceType, key: string, allowedAgeMs: number, loader: Loader<T>): Promise<CachedContent<T>> {
	const entry = await readEntry(key);
	if (entry && Date.now() - entry.loadedAt < allowedAgeMs) {
		countSourceCacheLookup(source, 'hit');
		return { data: entry.data as T, stale: false };
	}
	countSourceCacheLookup(source, 'miss');

	const result = await readUncached(key, loader);
	if (result.error) return entry && !(result.error instanceof ContentUnavailableError) ? { data: entry.data as T, stale: true } : result;
	await writeEntry(key, { data: result.data, loadedAt: Date.now() });
	return result;
}

export async function readEntry(key: string): Promise<Entry | undefined> {
	let entry: Entry | undefined;
	try {
		entry = await withTimeout(CACHE_STORE_TIMEOUT_MS, () => getCacheStore().get(key));
	} catch (error) {
		console.error(`Cache store could not read "${key}":`, error);
	}
	countCacheRead(getSettings().cacheStore.type, entry !== undefined);
	return entry;
}

export async function writeEntry(key: string, entry: Entry): Promise<void> {
	try {
		await withTimeout(CACHE_STORE_TIMEOUT_MS, () => getCacheStore().set(key, entry));
	} catch (error) {
		console.error(`Cache store could not write "${key}":`, error);
		countCacheWriteError(getSettings().cacheStore.type);
	}
}

function withTimeout<T>(timeoutMs: number, loader: Loader<T>): Promise<T> {
	const signal = AbortSignal.timeout(timeoutMs);
	const timedOut = new Promise<never>((_, reject) => {
		signal.addEventListener('abort', () => reject(signal.reason), { once: true });
	});
	return Promise.race([loader(signal), timedOut]);
}
