const SOURCE_TIMEOUT_MS = 10_000;

interface Entry {
	data: unknown;
	loadedAt: number;
}

export type CachedContent<T> = { data: T; stale: boolean; error?: undefined } | { data?: undefined; stale?: undefined; error: Error };

/** Reads a Source, and is told through the signal when it has counted as down. */
export type Loader<T> = (signal: AbortSignal) => Promise<T>;

const entries = new Map<string, Entry>();
const inFlightLoads = new Map<string, Promise<CachedContent<unknown>>>();

export async function readThrough<T>(key: string, allowedAgeMs: number, loader: Loader<T>): Promise<CachedContent<T>> {
	const entry = entries.get(key);
	if (entry && Date.now() - entry.loadedAt < allowedAgeMs) return { data: entry.data as T, stale: false };

	let load = inFlightLoads.get(key);
	if (!load) {
		load = refresh(key, loader).finally(() => inFlightLoads.delete(key));
		inFlightLoads.set(key, load);
	}
	return load as Promise<CachedContent<T>>;
}

/** Reads a Source with the cache left out, so it never stores or falls back on anything. */
export async function readUncached<T>(key: string, loader: Loader<T>): Promise<CachedContent<T>> {
	try {
		return { data: await withTimeout(loader), stale: false };
	} catch (error) {
		console.error(`Could not load "${key}":`, error);
		return { error: error instanceof Error ? error : new Error(String(error)) };
	}
}

async function refresh<T>(key: string, loader: Loader<T>): Promise<CachedContent<T>> {
	const result = await readUncached(key, loader);
	if (result.error) {
		const entry = entries.get(key);
		return entry ? { data: entry.data as T, stale: true } : result;
	}
	entries.set(key, { data: result.data, loadedAt: Date.now() });
	return result;
}

function withTimeout<T>(loader: Loader<T>): Promise<T> {
	const signal = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
	const timedOut = new Promise<never>((_, reject) => {
		signal.addEventListener('abort', () => reject(signal.reason), { once: true });
	});
	return Promise.race([loader(signal), timedOut]);
}
