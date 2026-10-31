import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { cacheStores } from './support/cache-stores.ts';
import { startFakeGitlab } from './support/fake-gitlab.ts';
import type { FakeGitlab } from './support/fake-gitlab.ts';
import { startupFailure, startVitrine } from './support/vitrine.ts';
import type { RunningVitrine } from './support/vitrine.ts';

const routes = [
	{ url: '/gitlab/:group+', controller: 'gitlab-group' },
	{ url: '/gitlab/:group+/-/:project', controller: 'gitlab-project' },
];

describe.each(cacheStores)('with the $name cache store', ({ empty }) => {
	describe('Routes to the GitLab Controllers', () => {
		let gitlab: FakeGitlab;
		let otherGitlab: FakeGitlab;
		let vitrine: RunningVitrine;

		beforeAll(async () => {
			gitlab = await startFakeGitlab({
				groups: [
					{ path: 'platform', name: 'The Platform', description: 'Everything we run' },
					{ path: 'platform/backend' },
					{ path: 'platform/backend/billing' },
					{ path: 'platform/frontend', notMember: true },
					{ path: 'hidden' },
				],
				projects: [
					{ path: 'platform/backend/api', description: 'The public API', last_activity_at: '2026-10-01T08:00:00.000Z' },
					{ path: 'platform/backend/billing/invoices' },
					{ path: 'platform/backend/legacy', archived: true },
					{ path: 'hidden/secret', sharedInto: ['platform'] },
				],
				token: 'secret-token',
			});
			otherGitlab = await startFakeGitlab({ groups: [{ path: 'tools' }], projects: [{ path: 'tools/cli' }] });
			vitrine = await startVitrine(
				{
					sources: [
						{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform'], tokenEnv: 'GITLAB_TOKEN' },
						{ name: 'tools-gitlab', type: 'gitlab', url: otherGitlab.url, mainGroups: ['tools'] },
					],
					routes,
					cacheStore: await empty(),
				},
				{ GITLAB_TOKEN: 'secret-token' },
			);
		});

		afterAll(async () => {
			await vitrine?.stop();
			await gitlab?.stop();
			await otherGitlab?.stop();
		});

		test('shows a Main Group with a link to GitLab', async () => {
			const html = await (await fetch(`${vitrine.url}/gitlab/platform`)).text();

			expect(html).toContain('The Platform');
			expect(html).toContain('Everything we run');
			expect(html).toContain(`href="${gitlab.url}/groups/platform"`);
		});

		test('links a Group to its direct subgroups only', async () => {
			const html = await (await fetch(`${vitrine.url}/gitlab/platform`)).text();

			expect(html).toContain('href="/gitlab/platform/backend"');
			expect(html).toContain('href="/gitlab/platform/frontend"');
			expect(html).not.toContain('href="/gitlab/platform/backend/billing"');
		});

		test('lists every Project beneath a Group, with its description, activity and links', async () => {
			const html = await (await fetch(`${vitrine.url}/gitlab/platform`)).text();

			expect(html).toContain('href="/gitlab/platform/backend/-/api"');
			expect(html).toContain('href="/gitlab/platform/backend/billing/-/invoices"');
			expect(html).toContain('The public API');
			expect(html).toContain('2026-10-01');
			expect(html).toContain(`href="${gitlab.url}/platform/backend/api"`);
		});

		test('leaves out archived Projects', async () => {
			expect(await (await fetch(`${vitrine.url}/gitlab/platform`)).text()).not.toContain('legacy');
		});

		test('leaves out Projects only shared into a Main Group', async () => {
			expect(await (await fetch(`${vitrine.url}/gitlab/platform`)).text()).not.toContain('secret');
		});

		test('shows a subgroup with only what is beneath it', async () => {
			const html = await (await fetch(`${vitrine.url}/gitlab/platform/backend/billing`)).text();

			expect(html).toContain('href="/gitlab/platform/backend/billing/-/invoices"');
			expect(html).not.toContain('backend/-/api');
		});

		test('finds a Group in whichever Source names its Main Group', async () => {
			expect(await (await fetch(`${vitrine.url}/gitlab/tools`)).text()).toContain('href="/gitlab/tools/-/cli"');
		});

		test('returns not found for a Group outside every Main Group, without asking the Source', async () => {
			const requests = gitlab.requests.length;

			expect((await fetch(`${vitrine.url}/gitlab/hidden`)).status).toBe(404);
			expect(gitlab.requests).toHaveLength(requests);
		});

		test('returns not found for a Group that does not exist beneath a Main Group', async () => {
			const response = await fetch(`${vitrine.url}/gitlab/platform/nothing`);

			expect(response.status).toBe(404);
			expect(await response.text()).toContain('Page not found');
		});

		test('sends the token of the Source', async () => {
			expect(await (await fetch(`${vitrine.url}/gitlab/platform`)).text()).not.toContain('could not be loaded');
		});
	});
});

describe.each(cacheStores)('a Project page with the $name cache store', ({ empty }) => {
	const issue = (title: string, extra: Record<string, unknown> = {}) => ({
		title,
		state: 'opened',
		confidential: false,
		web_url: `http://gitlab.test/issues/${title}`,
		assignees: [],
		labels: [],
		...extra,
	});
	let gitlab: FakeGitlab;
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		gitlab = await startFakeGitlab({
			groups: [{ path: 'platform' }, { path: 'platform/backend' }],
			projects: [
				{
					path: 'platform/backend/api',
					description: 'The public API',
					last_activity_at: '2026-10-01T08:00:00.000Z',
					readme: [
						'# Welcome to the API',
						'[Guide](docs/guide.md) and [site](https://example.com/site) and [bad](javascript:alert(1))',
						'![Logo](logo.png)',
						'<script>alert("readme")</script>',
						'<img src="x.png" onerror="alert(1)">',
					].join('\n\n'),
					commits: Array.from({ length: 12 }, (_, index) => ({
						id: `sha-${index}`,
						title: `Commit number ${index}`,
						author_name: 'Ada Lovelace',
						committed_date: '2026-09-15T08:00:00.000Z',
						web_url: `http://gitlab.test/commit/${index}`,
					})),
					issues: [
						issue('Fix the login', { assignees: [{ name: 'Grace Hopper' }], labels: ['bug', 'urgent'] }),
						issue('Closed work', { state: 'closed' }),
						issue('Private matter', { confidential: true }),
					],
					releases: [{ name: 'Spring release', tag_name: 'v1.2.0', released_at: '2026-03-20T08:00:00.000Z', _links: { self: 'http://gitlab.test/releases/v1.2.0' } }],
					contributors: [
						{ name: 'Few Commits', email: 'few@example.com', commits: 2 },
						{ name: 'Many Commits', email: 'many@example.com', commits: 40 },
					],
				},
				{ path: 'platform/backend/legacy', archived: true, readme: 'Archived content' },
				{ path: 'platform/backend/empty', empty_repo: true },
				{ path: 'platform/plain' },
				{ path: 'platform/never-opened' },
			],
		});
		vitrine = await startVitrine({
			sources: [{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform'] }],
			routes,
			cacheStore: await empty(),
		});
	});

	afterAll(async () => {
		await vitrine?.stop();
		await gitlab?.stop();
	});

	afterEach(() => {
		gitlab.behave('up');
	});

	const open = async (path: string) => (await fetch(`${vitrine.url}/gitlab/${path}`)).text();
	/** What the page shows in its sidebar. */
	const asideOf = (html: string) => html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));

	test('shows the name, description, activity and GitLab link of a Project', async () => {
		const html = await open('platform/backend/-/api');

		expect(html).toContain('<h1');
		expect(html).toContain('The public API');
		expect(html).toContain('2026-10-01');
		expect(html).toContain(`href="${gitlab.url}/platform/backend/api"`);
	});

	test('renders the README as HTML', async () => {
		expect(await open('platform/backend/-/api')).toMatch(/<h\d[^>]*>Welcome to the API<\/h\d>/);
	});

	test('points the relative links and images of the README at GitLab', async () => {
		const html = await open('platform/backend/-/api');

		expect(html).toContain(`href="${gitlab.url}/platform/backend/api/-/blob/main/docs/guide.md"`);
		expect(html).toContain(`src="${gitlab.url}/platform/backend/api/-/raw/main/logo.png"`);
		expect(html).toContain('href="https://example.com/site"');
	});

	test('strips anything executable from the README', async () => {
		const html = await open('platform/backend/-/api');

		expect(html).not.toContain('alert(');
		expect(html).not.toContain('onerror');
	});

	test('shows the last 10 commits', async () => {
		const html = await open('platform/backend/-/api');

		expect(html).toContain('Commit number 9');
		expect(html).not.toContain('Commit number 10');
		expect(html).toContain('Ada Lovelace');
		expect(html).toContain('href="http://gitlab.test/commit/0"');
	});

	test('shows open Issues with their assignees and labels, and never confidential ones', async () => {
		const html = await open('platform/backend/-/api');

		expect(html).toContain('Fix the login');
		expect(html).toContain('Grace Hopper');
		expect(html).toContain('urgent');
		expect(html).toContain('href="http://gitlab.test/issues/Fix the login"');
		expect(html).not.toContain('Closed work');
		expect(html).not.toContain('Private matter');
	});

	test('shows releases in the sidebar', async () => {
		const aside = asideOf(await open('platform/backend/-/api'));

		expect(aside).toContain('Spring release');
		expect(aside).toContain('v1.2.0');
		expect(aside).toContain('href="http://gitlab.test/releases/v1.2.0"');
	});

	test('shows contributors in the sidebar, most commits first and without their email', async () => {
		const html = await open('platform/backend/-/api');
		const aside = asideOf(html);

		expect(aside.indexOf('Many Commits')).toBeLessThan(aside.indexOf('Few Commits'));
		expect(aside.indexOf('Many Commits')).toBeGreaterThan(-1);
		expect(html).not.toContain('many@example.com');
	});

	test('says so when a Project has no README, commits or contributors', async () => {
		const html = await open('platform/backend/-/empty');

		expect(html).toContain('No README found.');
		expect(html).toContain('No commits found.');
		expect(html).toContain('No contributors found.');
	});

	test('shows a Project directly beneath a Main Group', async () => {
		expect(await open('platform/-/plain')).toContain('No README found.');
	});

	test('returns not found for a Project that does not exist', async () => {
		expect((await fetch(`${vitrine.url}/gitlab/platform/-/nothing`)).status).toBe(404);
	});

	test('returns not found for an archived Project and reads nothing about it', async () => {
		const response = await fetch(`${vitrine.url}/gitlab/platform/backend/-/legacy`);

		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain('Archived content');
		expect(gitlab.requests.filter((request) => request.startsWith('/api/v4/projects/2'))).toEqual([]);
	});

	test('limits a failure to the sections it hits', async () => {
		await open('platform');
		gitlab.behave('down-after-lists');

		const html = await open('platform/-/never-opened');

		expect(html).toContain('<h1');
		expect(html).toContain('never-opened');
		expect(html).toContain('Issues could not be loaded');
		expect(html).toContain('Releases could not be loaded');
	});

	test('reads the lists once per Main Group, whichever pages a Visitor opens', async () => {
		await open('platform');
		await open('platform/backend');
		await open('platform/backend/-/api');

		expect(gitlab.projectListRequests()).toHaveLength(1);
	});
});

describe('a GitLab Source that cannot answer', () => {
	let gitlab: FakeGitlab;
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		gitlab = await startFakeGitlab({ groups: [{ path: 'platform' }], projects: [{ path: 'platform/api' }] });
		vitrine = await startVitrine({
			sources: [{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform'], allowedAgeMinutes: 0 }],
			routes,
		});
	});

	afterAll(async () => {
		await vitrine?.stop();
		await gitlab?.stop();
	});

	afterEach(() => {
		gitlab.behave('up');
	});

	test('shows an error once, rather than one per Component', async () => {
		gitlab.behave('down');

		const response = await fetch(`${vitrine.url}/gitlab/platform/-/api`);

		expect(response.status).toBe(200);
		expect((await response.text()).match(/role="alert"/g)).toHaveLength(1);
	});

	test('gives up after one Source timeout, however many Components a page has', async () => {
		gitlab.behave('hanging');

		const started = Date.now();
		await (await fetch(`${vitrine.url}/gitlab/platform/-/api`)).text();

		expect(Date.now() - started).toBeLessThan(15_000);
	});

	test('shares one read of a Main Group between the Components of a page, even with the cache disabled', async () => {
		const before = gitlab.projectListRequests().length;

		await (await fetch(`${vitrine.url}/gitlab/platform/-/api`)).text();

		// One read decides that the page exists, and its Components share the next.
		expect(gitlab.projectListRequests().length - before).toBe(2);
	});
});

describe('other Routes to the GitLab Controllers', () => {
	let gitlab: FakeGitlab;
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		gitlab = await startFakeGitlab({
			groups: [{ path: 'acme' }, { path: 'acme/platform' }, { path: 'acme/platform/backend' }, { path: 'acme/sales' }, { path: 'data' }],
			projects: [{ path: 'acme/platform/backend/api' }, { path: 'data/warehouse' }],
		});
		vitrine = await startVitrine({
			sources: [
				{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['acme/platform', 'data'] },
				{ name: 'main-harbor', type: 'harbor', url: 'http://harbor.test', projects: ['platform'] },
			],
			routes: [
				{ url: '/code/:source/:group+', controller: 'gitlab-group' },
				{ url: '/code/:source/:group+/-/:project', controller: 'gitlab-project' },
				{ url: '/team', controller: 'gitlab-group', params: { group: 'acme/platform/backend' } },
				{ url: '/harbor/:source', controller: 'harbor' },
				{ url: '/harbor/:source/:project', controller: 'harbor-images' },
			],
		});
	});

	afterAll(async () => {
		await vitrine?.stop();
		await gitlab?.stop();
	});

	test('takes the Source from the URL and builds links with it', async () => {
		const html = await (await fetch(`${vitrine.url}/code/main-gitlab/acme/platform`)).text();

		expect(html).toContain('href="/code/main-gitlab/acme/platform/backend"');
		expect(html).toContain('href="/code/main-gitlab/acme/platform/backend/-/api"');
	});

	test('browses every Main Group of a Source', async () => {
		expect(await (await fetch(`${vitrine.url}/code/main-gitlab/data`)).text()).toContain('href="/code/main-gitlab/data/-/warehouse"');
	});

	test('takes the Group from the Route', async () => {
		expect(await (await fetch(`${vitrine.url}/team`)).text()).toContain('href="/code/main-gitlab/acme/platform/backend/-/api"');
	});

	test('shows a Project through a Route with the Source in its URL', async () => {
		expect((await fetch(`${vitrine.url}/code/main-gitlab/acme/platform/backend/-/api`)).status).toBe(200);
	});

	test.each([
		['a Group beside a nested Main Group', '/code/main-gitlab/acme/sales'],
		['the parent of a nested Main Group', '/code/main-gitlab/acme'],
		['a name that only starts like a Main Group', '/code/main-gitlab/acme/platform-other'],
		['an unknown Source', '/code/nope/acme/platform'],
		['a Harbor Source', '/code/main-harbor/acme/platform'],
		['a GitLab Source on a Harbor Route', '/harbor/main-gitlab'],
		['no Group at all', '/code/main-gitlab'],
		['a Project with no Group', '/code/main-gitlab/-/api'],
	])('returns not found for %s', async (_, url) => {
		expect((await fetch(`${vitrine.url}${url}`)).status).toBe(404);
	});
});

describe('invalid GitLab Settings stop startup', () => {
	const source = { name: 'main-gitlab', type: 'gitlab', url: 'http://gitlab.test', mainGroups: ['platform'] };

	test.each([
		['no Main Group', { sources: [{ ...source, mainGroups: [] }], routes: [] }, 'mainGroups'],
		['a Main Group with a trailing slash', { sources: [{ ...source, mainGroups: ['platform/'] }], routes: [] }, 'mainGroups'],
		['a Main Group named twice', { sources: [{ ...source, mainGroups: ['platform', 'platform'] }], routes: [] }, 'names Main Group "platform" twice'],
		['an unset token', { sources: [{ ...source, tokenEnv: 'VITRINE_UNSET' }], routes: [] }, 'VITRINE_UNSET'],
		['a Group Route with no way to its Projects', { sources: [source], routes: [routes[0]] }, 'needs a gitlab-project Route'],
		['a Group Route with no group', { sources: [source], routes: [{ url: '/gitlab', controller: 'gitlab-group' }] }, 'group'],
		['a Route taking two lists of segments', { sources: [source], routes: [{ url: '/:group+/:project+', controller: 'gitlab-project' }] }, ':name+'],
		['a Harbor Controller on a GitLab Source', { sources: [source], routes: [{ url: '/harbor', controller: 'harbor', params: { source: 'main-gitlab' } }] }, 'unknown Source'],
	])('with %s', async (_, settings, expectedError) => {
		const { exitCode, output } = await startupFailure(settings);

		expect(exitCode).toBe(1);
		expect(output).toContain(expectedError);
	});
});
