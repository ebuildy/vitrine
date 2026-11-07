import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { withSourceUrls } from '../demo/settings.ts';
import { startDemoSources } from '../demo/sources.ts';
import { messagesOf, startVitrine } from './support/vitrine.ts';
import type { RunningVitrine } from './support/vitrine.ts';

const secrets = { GITLAB_TOKEN: 'demo-token', HARBOR_PASSWORD: 'demo-password' };
// The demo's data/analytics has no Epics, which a GitLab tier answers on every visit, as nothing caches it.
const EPICS_UNAVAILABLE = '/roadmap/data/analytics: Epics are not available on main-gitlab: they need a GitLab tier that includes them.';

/** Runs `npm run warm-up` as an Administrator or a cron would, and returns how it ended. */
async function warmUp(...args: string[]) {
	try {
		const { stdout } = await promisify(execFile)('node', ['warm-up.ts', ...args]);
		return { exitCode: 0, output: stdout };
	} catch (error) {
		const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
		return { exitCode: code, output: stdout + stderr };
	}
}

/** The pages a report lists, by how each one ended. */
function pagesOf(output: string) {
	const messages = messagesOf(output);
	return {
		ok: messages.filter(({ msg }) => msg === 'Warm-up page ok').map(({ path }) => String(path)),
		failed: messages.filter(({ msg }) => msg === 'Warm-up page failed').map(({ path, problems }) => `${path}: ${(problems as string[]).join(' ')}`),
	};
}

/** The one message that ends a report. */
function summaryOf(output: string) {
	return messagesOf(output).filter(({ msg }) => msg === 'Warm-up finished');
}

describe('npm run warm-up against the demo', () => {
	let sources: Awaited<ReturnType<typeof startDemoSources>>;
	let vitrine: RunningVitrine;

	beforeEach(async () => {
		sources = await startDemoSources({ gitlabToken: secrets.GITLAB_TOKEN, harborPassword: secrets.HARBOR_PASSWORD });
		vitrine = await startVitrine(withSourceUrls(readFileSync('demo/settings.yaml', 'utf8'), sources.urls), secrets);
	});

	afterEach(async () => {
		await vitrine?.stop();
		await sources?.stop();
	});

	test('follows the links of every page to the nested ones, visiting each once, and reports how long it took', async () => {
		const { exitCode, output } = await warmUp(vitrine.url);

		expect(exitCode).toBe(1);
		const { ok, failed } = pagesOf(output);
		expect(failed).toEqual([EPICS_UNAVAILABLE]);
		expect(ok).toEqual(expect.arrayContaining(['/', '/images', '/nexus/main-nexus', '/gitlab/platform', '/gitlab/platform/backend/billing', '/gitlab/platform/backend/-/worker', '/harbor/main-harbor', '/roadmap/platform']));
		expect(new Set(ok).size).toBe(ok.length);
		expect(summaryOf(output)).toEqual([{ time: expect.any(String), level: 'error', msg: 'Warm-up finished', baseUrl: vitrine.url, pages: ok.length + 1, failed: 1, seconds: expect.any(Number) }]);
	});

	test('never follows a link out of Vitrine, nor one with a query', async () => {
		const { output } = await warmUp(vitrine.url);

		const { ok } = pagesOf(output);
		expect(ok.every((path) => path.startsWith('/') && !path.includes('?'))).toBe(true);
		// Pages link to each Source, as Vitrine only links to content: none of these is an API request.
		expect(sources.fakes['main-nexus'].requests.every((request) => request.startsWith('/service/rest/'))).toBe(true);
		expect(sources.fakes['main-gitlab'].requests.every((request) => request.startsWith('/api/'))).toBe(true);
	});

	test('fills the cache, so that a second warm-up costs the Sources nothing', async () => {
		await warmUp(vitrine.url);
		const before = Object.values(sources.fakes).map(({ requests }) => requests.length);

		const { output } = await warmUp(vitrine.url);

		expect(pagesOf(output).failed).toEqual([EPICS_UNAVAILABLE]);
		// Each visit asks GitLab again whether it has Epics, and nothing else.
		const { 'main-gitlab': gitlab, ...others } = sources.fakes;
		expect(Object.values(others).map(({ requests }) => requests.length)).toEqual(before.slice(1));
		expect(gitlab.requests.slice(before[0]).every((request) => gitlab.graphqlRequests().includes(request))).toBe(true);
	});

	test('lists the pages it visited in /sitemap.xml', async () => {
		const { output } = await warmUp(vitrine.url);

		const sitemap = await (await fetch(`${vitrine.url}/sitemap.xml`)).text();
		for (const path of pagesOf(output).ok) expect(sitemap).toContain(`<loc>${vitrine.url}${path}</loc>`);
	});

	test('reports a Source that is down on each page reading it, carries on with the other pages and ends with an error', async () => {
		sources.fakes['main-nexus'].behave('down');

		const { exitCode, output } = await warmUp(vitrine.url);

		expect(exitCode).toBe(1);
		const { ok, failed } = pagesOf(output);
		expect(failed).toContain('/nexus/main-nexus: Repositories could not be loaded because main-nexus is down.');
		expect(ok).toEqual(expect.arrayContaining(['/gitlab/platform', '/images']));
		expect(summaryOf(output)).toMatchObject([{ pages: ok.length + failed.length, failed: failed.length }]);
	});

	test('requests as many pages at once as --concurrency allows', async () => {
		const { output } = await warmUp(vitrine.url, '--concurrency', '1');

		expect(pagesOf(output).failed).toEqual([EPICS_UNAVAILABLE]);
		expect(pagesOf(output).ok).toContain('/nexus/main-nexus');
	});
});

describe('npm run warm-up with wrong arguments', () => {
	test.each([
		['no base URL', [], 'Usage: npm run warm-up -- <base URL>'],
		['a base URL that is no URL', ['vitrine'], 'Usage: npm run warm-up -- <base URL>'],
		['a concurrency of zero', ['http://127.0.0.1:1', '--concurrency', '0'], '--concurrency must be a whole number above zero'],
	])('stops with %s', async (_, args, expectedError) => {
		const { exitCode, output } = await warmUp(...args);

		expect(exitCode).toBe(2);
		expect(output).toContain(expectedError);
	});

	test('reports a Vitrine that does not answer as a failed page', async () => {
		const { exitCode, output } = await warmUp('http://127.0.0.1:1');

		expect(exitCode).toBe(1);
		expect(pagesOf(output).failed[0]).toMatch(/^\/: /);
		expect(messagesOf(output).every(({ msg }) => !msg.includes('\n'))).toBe(true);
	});
});
