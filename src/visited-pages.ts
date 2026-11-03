import { readEntry, writeEntry } from './content-cache.ts';

/** Every Source key holds a `/` after the Source name, so this key never meets one. */
const KEY = 'visited-pages';

/** The time of its last visit, by URL path. */
export type VisitedPages = Record<string, number>;

const pending = new Map<string, number>();
let writes: Promise<void> = Promise.resolve();

/** Records a page that answered with status 200. Visits made together go to the cache store in one write. */
export function recordVisit(path: string, at = Date.now()): void {
	pending.set(path, at);
	writes = writes.then(writePending);
}

async function writePending() {
	if (pending.size === 0) return;
	const visits = Object.fromEntries(pending);
	pending.clear();
	const stored = (await readEntry(KEY))?.data as VisitedPages | undefined;
	await writeEntry(KEY, { data: { ...stored, ...visits }, loadedAt: Date.now() });
}

/** The pages visited with status 200, those recorded just before included. */
export async function visitedPages(): Promise<VisitedPages> {
	await writes;
	return ((await readEntry(KEY))?.data as VisitedPages | undefined) ?? {};
}
