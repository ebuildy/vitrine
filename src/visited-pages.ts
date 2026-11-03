import { readEntry, writeEntry } from './content-cache.ts';

/** Every Source key holds a `/` after the Source name, so this key never meets one. See ADR 0007. */
const KEY = 'visited-pages';

/** A page visited again this soon keeps the time of its last visit, so that busy pages do not write on every request. */
const RECORD_AGAIN_AFTER_MS = 60_000;

/** The time of its last visit with status 200, by URL path. */
export type VisitTimes = Record<string, number>;

/** What to write next: the time of a visit, or undefined for a page that is gone. */
const pending = new Map<string, number | undefined>();
const lastRecorded = new Map<string, number>();
let writes: Promise<void> = Promise.resolve();

/** Records a page that answered with status 200. Visits made together go to the cache store in one write. */
export function recordVisit(path: string, at = Date.now()): void {
	if (at - (lastRecorded.get(path) ?? -Infinity) < RECORD_AGAIN_AFTER_MS) return;
	lastRecorded.set(path, at);
	queue(path, at);
}

/** Forgets a page that is not found any more, so that the sitemap and warm-ups leave it out. */
export function forgetPage(path: string): void {
	lastRecorded.delete(path);
	queue(path, undefined);
}

function queue(path: string, at: number | undefined) {
	pending.set(path, at);
	writes = writes.then(writePending);
}

async function writePending() {
	if (pending.size === 0) return;
	const changes = [...pending];
	pending.clear();
	const times = await readVisitTimes();
	// A page that is not found, and never was visited, costs no write.
	if (changes.every(([path, at]) => at === undefined && !(path in times))) return;
	for (const [path, at] of changes) {
		if (at === undefined) delete times[path];
		else times[path] = at;
	}
	await writeEntry(KEY, { data: times, loadedAt: Date.now() });
}

async function readVisitTimes(): Promise<VisitTimes> {
	return { ...((await readEntry(KEY))?.data as VisitTimes | undefined) };
}

/** The pages visited with status 200, those recorded just before included. */
export async function visitTimes(): Promise<VisitTimes> {
	await writes;
	return readVisitTimes();
}
