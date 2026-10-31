const SOURCE_TIMEOUT_MS = 10_000;

interface Entry {
	data: unknown;
	loadedAt: number;
}

export type CachedContent<T> = { data: T; stale: boolean; error?: undefined } | { data?: undefined; error: Error };

/** Reads a Source, and is told through the signal when it has counted as down. */
export type Loader<T> = (signal: AbortSignal) => Promise<T>;

const entries = new Map<string, Entry>();
const loads = new Map<string, Promise<CachedContent<unknown>>>();

export async function readThrough<T>(key: string, allowedAgeMs: number, loader: Loader<T>): Promise<CachedContent<T>> {
	const entry = entries.get(key);
	if (entry && Date.now() - entry.loadedAt < allowedAgeMs) return { data: entry.data as T, stale: false };

	let load = loads.get(key);
	if (!load) {
		load = refresh(key, loader).finally(() => loads.delete(key));
		loads.set(key, load);
	}
	return load as Promise<CachedContent<T>>;
}

async function refresh<T>(key: string, loader: Loader<T>): Promise<CachedContent<T>> {
	try {
		const data = await withTimeout(loader);
		entries.set(key, { data, loadedAt: Date.now() });
		return { data, stale: false };
	} catch (error) {
		console.error(`Could not load "${key}":`, error);
		const entry = entries.get(key);
		if (entry) return { data: entry.data as T, stale: true };
		return { error: error instanceof Error ? error : new Error(String(error)) };
	}
}

function withTimeout<T>(loader: Loader<T>): Promise<T> {
	const signal = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
	const timedOut = new Promise<never>((_, reject) => {
		signal.addEventListener('abort', () => reject(signal.reason), { once: true });
	});
	return Promise.race([loader(signal), timedOut]);
}
