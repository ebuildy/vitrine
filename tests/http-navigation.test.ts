import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { startFakeGitlab } from './support/fake-gitlab.ts';
import type { FakeGitlab } from './support/fake-gitlab.ts';
import { startFakeHarbor } from './support/fake-harbor.ts';
import type { FakeHarbor } from './support/fake-harbor.ts';
import { startupFailure, startVitrine } from './support/vitrine.ts';
import type { RunningVitrine } from './support/vitrine.ts';

const release = (index: number) => ({ name: `Release ${index}`, tag_name: `v${index}`, released_at: `2026-0${index + 1}-01T08:00:00.000Z` });

describe('a Route to the navigation Controller', () => {
	let gitlab: FakeGitlab;
	let harbors: FakeHarbor[];
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		gitlab = await startFakeGitlab({
			groups: [
				{ path: 'platform', name: 'The Platform', members: Array.from({ length: 7 }, (_, index) => ({ id: index + 1, name: `Person ${index}` })) },
				{ path: 'platform/backend', name: 'The Backend' },
				{ path: 'data', name: 'The Data', members: [{ id: 100, name: 'Dana' }] },
			],
			projects: [
				{ path: 'platform/api', releases: Array.from({ length: 5 }, (_, index) => release(index)) },
				{ path: 'platform/worker', releases: [release(5), release(6)] },
				{ path: 'data/warehouse', releases: [release(7)] },
			],
		});
		harbors = await Promise.all([startFakeHarbor({ projects: { library: [], unselected: [] } }), startFakeHarbor({ projects: { tools: [] } })]);
		vitrine = await startVitrine({
			sources: [
				{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform', 'data'] },
				{ name: 'main-harbor', type: 'harbor', url: harbors[0].url, projects: ['library'] },
				{ name: 'tools-harbor', type: 'harbor', url: harbors[1].url, projects: ['tools'] },
			],
			routes: [
				{ url: '/', controller: 'navigation' },
				{ url: '/short', controller: 'navigation', params: { arrangement: 'list', maxItems: 2 } },
				{ url: '/single', controller: 'navigation', params: { maxItems: 1 } },
				{ url: '/images', controller: 'harbor-images' },
				{ url: '/harbor/:source', controller: 'harbor' },
				{ url: '/harbor/:source/:project', controller: 'harbor-images' },
				{ url: '/gitlab/:group+', controller: 'gitlab-group' },
				{ url: '/gitlab/:group+/-/:project', controller: 'gitlab-project' },
				{ url: '/issues/:group+', controller: 'gitlab-issues' },
				{ url: '/roadmap/:group+', controller: 'gitlab-roadmap' },
			],
		});
	});

	afterAll(async () => {
		await vitrine?.stop();
		await gitlab?.stop();
		await Promise.all(harbors?.map((harbor) => harbor.stop()) ?? []);
	});

	afterEach(() => {
		harbors[0].behave('up');
	});

	const open = async (url: string) => (await fetch(`${vitrine.url}${url}`)).text();

	test('shows releases, Harbor projects, Members and Groups of every Source', async () => {
		const html = await open('/');

		for (const shown of ['Release 7', 'Release 6', 'href="/harbor/main-harbor/library"', 'href="/harbor/tools-harbor/tools"', 'Person 0', 'Dana', 'The Platform', 'The Data']) {
			expect(html).toContain(shown);
		}
	});

	test('heads its sections, and tells apart the lists of several Main Groups and Sources', async () => {
		const html = await open('/');
		const headings = (level: string) => [...html.matchAll(new RegExp(`<${level}[^>]*>([^<]*)</${level}>`, 'g'))].map(([, text]) => text);

		expect(headings('h2')).toEqual(expect.arrayContaining(['Overview', 'Members', 'Groups']));
		expect(headings('h3')).toEqual(expect.arrayContaining(['Releases of platform', 'Releases of data', 'Harbor projects of main-harbor', 'platform', 'data', 'main-gitlab']));
	});

	test('shows only the selected Harbor projects', async () => {
		expect(await open('/')).not.toContain('unselected');
	});

	test('holds the Groups to maxItems too', async () => {
		const html = await open('/single');

		expect(html).toContain('The Platform');
		expect(html).not.toContain('The Data');
	});

	test('shows five items of each list unless the Route says otherwise', async () => {
		const html = await open('/');

		expect(html.match(/Person \d/g)).toHaveLength(5);
		expect(html.match(/Release \d/g)).toHaveLength(6);
	});

	test('shows the maxItems of the Route, whose number stays out of quotes in Settings', async () => {
		const html = await open('/short');

		expect(html.match(/Person \d/g)).toHaveLength(2);
		expect(html.match(/Release \d/g)).toHaveLength(3);
	});

	test('leads to the pages about each Source', async () => {
		const html = await open('/short');

		for (const url of ['/gitlab/platform', '/gitlab/data', '/issues/platform', '/roadmap/platform', '/harbor/main-harbor', '/harbor/tools-harbor', '/gitlab/platform/-/worker']) {
			expect(html).toContain(`href="${url}"`);
		}
	});

	test('leads to the Routes with a fixed URL, other Navigation pages included, but not to itself', async () => {
		const html = await open('/');

		expect(html).toContain('href="/images"');
		expect(html).toContain('href="/short"');
		expect(html).not.toContain('href="/"');
		expect(html).not.toContain(':source');
		expect(await open('/short')).toContain('href="/"');
	});

	test('keeps showing the other Sources when one is down', async () => {
		harbors[0].behave('down');
		const response = await fetch(`${vitrine.url}/short`);

		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('href="/harbor/tools-harbor/tools"');
		expect(html).toContain('Person 0');
	});
});

test('leaves out the sections no Source has content for', async () => {
	const harbor = await startFakeHarbor({ projects: { library: [] } });
	const vitrine = await startVitrine({ sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['library'] }], routes: [{ url: '/', controller: 'navigation' }] });

	const html = await (await fetch(`${vitrine.url}/`)).text();
	await vitrine.stop();
	await harbor.stop();

	expect(html).toContain('Overview');
	expect(html).not.toContain('>Members<');
	expect(html).not.toContain('>Groups<');
	expect(html).not.toContain('>Pages<');
});

describe('invalid navigation Routes stop startup', () => {
	test.each([
		['an unknown arrangement', { url: '/', controller: 'navigation', params: { arrangement: 'nope' } }, 'arrangement'],
		['a maxItems of zero', { url: '/', controller: 'navigation', params: { maxItems: 0 } }, 'maxItems'],
		['a maxItems that is not whole', { url: '/', controller: 'navigation', params: { maxItems: 1.5 } }, 'maxItems'],
		['a maxItems taken from the URL', { url: '/:maxItems', controller: 'navigation' }, 'maxItems'],
		['a Source', { url: '/', controller: 'navigation', params: { source: 'main-gitlab' } }, 'source'],
	])('with %s', async (_, route, expectedError) => {
		const { exitCode, output } = await startupFailure({ sources: [], routes: [route] });

		expect(exitCode).toBe(1);
		expect(output).toContain(expectedError);
	});
});
