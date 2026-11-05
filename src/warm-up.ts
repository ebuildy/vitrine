// Runs in `npm run warm-up` as well as in the server, so it reads no Settings: what it needs comes as arguments.
import { logger } from './logger.mjs';
import type { Settings } from './settings.ts';

/** Longer than a page takes with every Source timing out, which is the slowest a page can be. */
const PAGE_TIMEOUT_MS = 60_000;

export const DEFAULT_CONCURRENCY = 4;

export interface WarmUpOptions {
	/** How many pages are requested at once, so that a warm-up does not flood the Sources. */
	concurrency?: number;
	/** Where the crawl starts, besides every page /sitemap.xml lists. */
	startPaths?: string[];
}

export interface PageReport {
	path: string;
	/** What went wrong, such as a status or the alerts of a Source that is down. Empty when the page is fine. */
	problems: string[];
}

export interface WarmUpReport {
	baseUrl: string;
	pages: PageReport[];
	durationMs: number;
}

/**
 * Crawls Vitrine like a Visitor would, so that each page reads its Sources through the cache and fills it. It follows
 * the links of every page to Vitrine itself, never to a Source or an external site, and visits each URL once.
 */
export async function warmUp(baseUrl: string, { concurrency = DEFAULT_CONCURRENCY, startPaths = [] }: WarmUpOptions = {}): Promise<WarmUpReport> {
	const started = Date.now();
	const base = new URL(baseUrl);
	const seen = new Set<string>();
	const queue: URL[] = [];
	const pages: PageReport[] = [];

	const enqueue = (href: string, from: URL) => {
		const url = sameOriginPage(href, from, base);
		if (!url || seen.has(url.href)) return;
		seen.add(url.href);
		queue.push(url);
	};

	for (const path of [...startPaths, ...(await sitemapPaths(base))]) enqueue(path, base);

	await new Promise<void>((resolve) => {
		let active = 0;
		const next = () => {
			while (active < concurrency && queue.length > 0) {
				const url = queue.shift() as URL;
				active++;
				visit(url).then(({ problems, links }) => {
					pages.push({ path: url.pathname, problems });
					for (const link of links) enqueue(link, url);
					active--;
					next();
				});
			}
			if (active === 0) resolve();
		};
		next();
	});

	return { baseUrl: base.origin, pages, durationMs: Date.now() - started };
}

/** A page of Vitrine to visit, with no query, which only varies a page, and no fragment, which only scrolls it. */
function sameOriginPage(href: string, from: URL, base: URL): URL | undefined {
	let url: URL;
	try {
		url = new URL(href, from);
	} catch {
		return undefined;
	}
	if (url.origin !== base.origin || url.search) return undefined;
	url.hash = '';
	return url;
}

/** The pages Vitrine served before, by its /sitemap.xml, so that a warm-up also refills those no link leads to. */
async function sitemapPaths(base: URL): Promise<string[]> {
	try {
		const response = await fetch(new URL('/sitemap.xml', base), { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
		if (!response.ok) return [];
		return [...(await response.text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, loc]) => decodeEntities(loc));
	} catch {
		return [];
	}
}

async function visit(url: URL): Promise<{ problems: string[]; links: string[] }> {
	try {
		const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), headers: { 'user-agent': 'Vitrine warm-up' } });
		const location = response.headers.get('location');
		if (response.status >= 300 && response.status < 400 && location) {
			await response.body?.cancel();
			return { problems: [], links: [location] };
		}
		const html = await response.text();
		const problems = response.status === 200 ? alertsOf(html) : [`status ${response.status}`];
		return { problems, links: linksOf(html) };
	} catch (error) {
		const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
		return { problems: [`${error instanceof Error ? error.message : String(error)}${cause}`], links: [] };
	}
}

function linksOf(html: string): string[] {
	return [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map(([, href]) => decodeEntities(href));
}

/** What a page tells a Visitor went wrong: a Source that is down, Stale content, or a Template that failed. */
function alertsOf(html: string): string[] {
	const alerts = [...html.matchAll(/<(\w+)\b[^>]*\brole="(?:alert|status)"[^>]*>([\s\S]*?)<\/\1>/g)].map(([, , content]) =>
		decodeEntities(content.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
	);
	return [...new Set(alerts)];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" };

function decodeEntities(text: string) {
	return text.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (_, name: string) => ENTITIES[name]);
}

export function failedPages(report: WarmUpReport): PageReport[] {
	return report.pages.filter(({ problems }) => problems.length > 0);
}

/** One message per page, then a summary, as an Administrator reads them in a log. */
export function logReport(report: WarmUpReport) {
	for (const { path, problems } of report.pages) {
		if (problems.length > 0) logger.error('Warm-up page failed', { path, problems });
		else logger.info('Warm-up page ok', { path });
	}
	const failed = failedPages(report).length;
	const fields = { baseUrl: report.baseUrl, pages: report.pages.length, failed, seconds: Math.round(report.durationMs / 100) / 10 };
	if (failed > 0) logger.error('Warm-up finished', fields);
	else logger.info('Warm-up finished', fields);
}

/** Runs the warm-ups Settings ask for in the background, logging each report, and returns what stops them. */
export function scheduleWarmUps(baseUrl: string, { atStart, everyMinutes, concurrency }: Settings['warmUp'], startPaths: string[]): () => void {
	let running = false;
	const run = async () => {
		// A warm-up longer than the interval is not run twice at once.
		if (running) return;
		running = true;
		try {
			const report = await warmUp(baseUrl, { concurrency, startPaths });
			logReport(report);
		} catch (error) {
			logger.error('The warm-up stopped', { error });
		} finally {
			running = false;
		}
	};
	if (atStart) void run();
	const timer = everyMinutes === undefined ? undefined : setInterval(run, everyMinutes * 60_000);
	// The server stops by itself once it closes, and a timer must not keep it alive.
	timer?.unref();
	return () => clearInterval(timer);
}
