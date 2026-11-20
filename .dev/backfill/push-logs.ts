// Pushes the fake logs of generate.ts to Loki, with the moments they were written at: `node push-logs.ts`, with LOKI_URL and BACKFILL_LOGS_FILE.
// Each line of the file is `nanoseconds <TAB> instance <TAB> level <TAB> JSON`. A stream is a pod and a level, labelled as a collector such as Grafana Alloy would
// label them: `job`, `instance`, and `level`, which has four values only.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';
const FILE = process.env.BACKFILL_LOGS_FILE ?? 'logs.tsv';
const BATCH = 4000;

async function waitUntilReady() {
	for (let attempt = 0; attempt < 90; attempt++) {
		try {
			if ((await fetch(`${LOKI_URL}/ready`)).ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error(`Loki at ${LOKI_URL} is not ready after 90 seconds`);
}

type Entries = Map<string, { stream: Record<string, string>; values: Array<[string, string]> }>;

async function push(entries: Entries) {
	const body = JSON.stringify({ streams: [...entries.values()] });
	for (let attempt = 1; ; attempt++) {
		const response = await fetch(`${LOKI_URL}/loki/api/v1/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
		if (response.ok) return;
		if (attempt === 5) throw new Error(`Loki answered ${response.status}: ${await response.text()}`);
		await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
	}
}

await waitUntilReady();

let entries: Entries = new Map();
let inBatch = 0;
let total = 0;
for await (const record of createInterface({ input: createReadStream(FILE), crlfDelay: Number.POSITIVE_INFINITY })) {
	const [nanoseconds, instance, level, ...line] = record.split('\t');
	const key = `${instance} ${level}`;
	let stream = entries.get(key);
	if (!stream) {
		stream = { stream: { job: 'vitrine', instance, level }, values: [] };
		entries.set(key, stream);
	}
	stream.values.push([nanoseconds, line.join('\t')]);
	total++;
	if (++inBatch === BATCH) {
		await push(entries);
		entries = new Map();
		inBatch = 0;
	}
}
if (inBatch > 0) await push(entries);

// Lines of a quiet stream, such as the one warning of a pod, stay in the memory of the ingester for 30 minutes, where queries about old logs do not
// look: flush them to storage. Then wait until Loki sees them all, so that no one reads a half-empty week.
await fetch(`${LOKI_URL}/flush`, { method: 'POST' });
async function seen(): Promise<number> {
	const query = new URLSearchParams({ query: 'sum(count_over_time({job="vitrine"}[9d]))' });
	const answer = (await (await fetch(`${LOKI_URL}/loki/api/v1/query?${query}`)).json()) as { data?: { result?: Array<{ value: [number, string] }> } };
	return Number(answer.data?.result?.[0]?.value[1] ?? 0);
}
for (let attempt = 0; attempt < 120 && (await seen()) < total * 0.999; attempt++) await new Promise((resolve) => setTimeout(resolve, 1000));
console.log(`${total} log lines pushed to ${LOKI_URL}, ${await seen()} seen`);
