import { parseArgs } from 'node:util';
import { DEFAULT_CONCURRENCY, failedPages, formatReport, warmUp } from './src/warm-up.ts';

const USAGE = `Usage: npm run warm-up -- <base URL> [path...] [--concurrency <pages at once, ${DEFAULT_CONCURRENCY} by default>]
Crawls a running Vitrine from each path given, / when there is none, and every page of its /sitemap.xml, to fill its cache.`;

function usageError(message: string): never {
	console.error(`${message}\n${USAGE}`);
	process.exit(2);
}

let parsed;
try {
	parsed = parseArgs({ allowPositionals: true, options: { concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) } } });
} catch (error) {
	usageError(error instanceof Error ? error.message : String(error));
}
const [baseUrl, ...paths] = parsed.positionals;
if (!baseUrl || !URL.canParse(baseUrl) || !/^https?:$/.test(new URL(baseUrl).protocol)) usageError('The base URL of Vitrine is missing, or is not an http:// or https:// URL.');
if (!/^[1-9]\d*$/.test(parsed.values.concurrency)) usageError('--concurrency must be a whole number above zero.');

const report = await warmUp(baseUrl, { concurrency: Number(parsed.values.concurrency), startPaths: paths.length > 0 ? paths : ['/'] });
console.log(formatReport(report));
// A cron sees the warm-up fail when a page did, such as when a Source is down.
process.exit(failedPages(report).length > 0 ? 1 : 0);
