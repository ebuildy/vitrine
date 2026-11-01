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

/** What a Visitor reads, with the markup left out. */
function textOf(html: string) {
	return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

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
					{
						path: 'platform/backend/api',
						description: 'The public API',
						last_activity_at: '2026-10-01T08:00:00.000Z',
						topics: ['golang', 'payments'],
						commit_count: 1234,
						releases: [
							{ name: 'Autumn release', tag_name: 'v2', released_at: '2026-10-01T08:00:00.000Z' },
							{ name: 'Spring release', tag_name: 'v1', released_at: '2026-03-20T08:00:00.000Z' },
						],
						contributors: [
							{ name: 'Ada Lovelace', email: 'ada@example.com', commits: 40 },
							{ name: 'Grace Hopper', email: 'grace@example.com', commits: 2 },
						],
					},
					{ path: 'platform/backend/billing/invoices' },
					{ path: 'platform/backend/legacy', archived: true },
					{ path: 'hidden/secret', sharedInto: ['platform'] },
				],
				avatars: { 'ada@example.com': 'http://gitlab.test/ada.png' },
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

		test('titles and describes the page after its Group', async () => {
			const html = await (await fetch(`${vitrine.url}/gitlab/platform`)).text();

			expect(html).toContain('<title>The Platform</title>');
			expect(html).toContain('<meta name="description" content="Everything we run">');
		});

		test('titles and describes the page after its Project', async () => {
			const html = await (await fetch(`${vitrine.url}/gitlab/platform/backend/-/api`)).text();

			expect(html).toContain('<title>api</title>');
			expect(html).toContain('<meta name="description" content="The public API">');
		});

		test('leaves the description out of a page whose Group has none', async () => {
			expect(await (await fetch(`${vitrine.url}/gitlab/platform/backend`)).text()).not.toContain('name="description"');
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

		test('counts the Projects beneath each subgroup, leaving out archived ones', async () => {
			const text = textOf(await (await fetch(`${vitrine.url}/gitlab/platform`)).text());

			expect(text).toContain('backend 2 Projects');
			expect(text).toContain('frontend 0 Projects');
		});

		test('shows the topics, commit count and latest release of a Project card', async () => {
			const text = textOf(await (await fetch(`${vitrine.url}/gitlab/platform`)).text());

			expect(text).toContain('golang payments');
			expect(text).toContain('1234 commits');
			expect(text).toContain('Latest release Autumn release');
			expect(text).not.toContain('Spring release');
		});

		test('shows contributors on a Project card as avatars only', async () => {
			const html = await (await fetch(`${vitrine.url}/gitlab/platform`)).text();

			expect(html).toContain('src="http://gitlab.test/ada.png"');
			expect(html).toContain('alt="Ada Lovelace"');
			expect(textOf(html)).not.toContain('Ada Lovelace');
			expect(html).not.toContain('ada@example.com');
		});

		test('marks a contributor with no avatar by their initials', async () => {
			expect(textOf(await (await fetch(`${vitrine.url}/gitlab/platform`)).text())).toContain(' GH ');
		});

		test('leaves out what a Project card has nothing to show for', async () => {
			const text = textOf(await (await fetch(`${vitrine.url}/gitlab/platform/backend/billing`)).text());

			expect(text).not.toContain('commits');
			expect(text).not.toContain('Latest release');
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

describe.each(cacheStores)('the Members of a Group with the $name cache store', ({ empty }) => {
	const ada = {
		id: 1,
		name: 'Ada Lovelace',
		avatar_url: 'http://gitlab.test/ada.png',
		location: 'London',
		public_email: 'ada@example.com',
		email: 'ada.private@example.com',
	};
	const grace = { id: 2, name: 'Grace Hopper', location: '', public_email: '' };
	const linus = { id: 3, name: 'Linus Torvalds' };
	const katherine = { id: 4, name: 'Katherine Johnson' };
	let gitlab: FakeGitlab;
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		gitlab = await startFakeGitlab({
			groups: [
				{
					path: 'platform',
					members: [
						ada,
						{ id: 10, name: 'Deploy Bot', bot: true },
						{ id: 11, name: 'Gone Person', state: 'blocked' },
						{ id: 12, name: 'Directory Leaver', state: 'ldap_blocked' },
						{ id: 13, name: 'Banned Person', state: 'banned' },
					],
				},
				{ path: 'platform/backend', members: [ada, grace] },
				{ path: 'platform/frontend', members: [linus] },
			],
			projects: [{ path: 'platform/backend/api', members: [katherine] }],
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

	const open = async (path: string) => (await fetch(`${vitrine.url}/gitlab/${path}`)).text();
	const membersOf = (html: string) => html.slice(html.search(/<h2[^>]*>Members/));
	/** The card of one Member. */
	const cardOf = (html: string, name: string) => membersOf(html).split('<li').find((card) => card.includes(name)) ?? '';

	test('leaves blank what a profile does not give', async () => {
		const card = cardOf(await open('platform'), 'Grace Hopper');

		expect(textOf(card)).not.toContain('GH');
		expect(card).toMatch(/<span class="avatar"[^>]*><\/span>/);
		expect(card).not.toContain('<img');
		expect(card).not.toContain('<p');
		expect(card).not.toContain('mailto');
	});

	test('leaves out bots and blocked accounts', async () => {
		const html = await open('platform');

		for (const name of ['Deploy Bot', 'Gone Person', 'Directory Leaver', 'Banned Person']) expect(html).not.toContain(name);
	});

	test('shows the Members of everything beneath a Main Group, each once and by name', async () => {
		const text = textOf(membersOf(await open('platform'))).replace('Members', '');

		expect(text.match(/[A-Z][a-z]+ [A-Z][a-z]+/g)).toEqual(['Ada Lovelace', 'Grace Hopper', 'Katherine Johnson', 'Linus Torvalds']);
	});

	test('shows a subgroup with the Members at or beneath it, and those it inherits', async () => {
		const text = textOf(membersOf(await open('platform/backend')));

		expect(text).toContain('Ada Lovelace');
		expect(text).toContain('Grace Hopper');
		expect(text).toContain('Katherine Johnson');
		expect(text).not.toContain('Linus Torvalds');
	});

	test('reads the whole list once per Main Group, and each Member once', async () => {
		await open('platform');
		await open('platform/backend');
		await open('platform/frontend');

		expect(gitlab.memberRequests().filter((request) => request === '/api/v4/users/1')).toHaveLength(1);
		expect(gitlab.memberRequests().filter((request) => request.includes('/groups/platform/members'))).toHaveLength(1);
	});

	test('reads no profile of a blocked account', async () => {
		await open('platform');

		expect(gitlab.requests).not.toContain('/api/v4/users/11');
	});

	test('shows the avatar, name, location and email of a Member at the bottom of the page', async () => {
		const html = await open('platform');
		const members = membersOf(html);

		expect(html.indexOf(members)).toBeGreaterThan(html.search(/<h2[^>]*>Projects/));
		expect(members).toContain('src="http://gitlab.test/ada.png"');
		expect(members).toContain('Ada Lovelace');
		expect(members).toContain('London');
		expect(members).toContain('ada@example.com');
	});

	test('never shows the private email of a token that can read it', async () => {
		expect(await open('platform')).not.toContain('ada.private@example.com');
	});
});

describe('Members when GitLab holds something back', () => {
	const ada = { id: 1, name: 'Ada Lovelace', avatar_url: 'http://gitlab.test/ada.png' };

	const running: { gitlab: FakeGitlab; vitrine: RunningVitrine }[] = [];
	const open = async ({ url }: RunningVitrine) => (await fetch(`${url}/gitlab/platform`)).text();
	const start = async (options: Parameters<typeof startFakeGitlab>[0]) => {
		const gitlab = await startFakeGitlab(options);
		const vitrine = await startVitrine({ sources: [{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform'] }], routes });
		running.push({ gitlab, vitrine });
		return { gitlab, vitrine };
	};

	afterEach(async () => {
		for (const { gitlab, vitrine } of running.splice(0)) {
			await vitrine.stop();
			await gitlab.stop();
		}
	});

	test('still shows the Member when GitLab refuses their profile', async () => {
		const { vitrine } = await start({ groups: [{ path: 'platform', members: [ada] }], profilesRefused: true });

		const html = await open(vitrine);

		expect(html).toContain('Ada Lovelace');
		expect(html).not.toContain('could not be loaded');
	});

	test('keeps the list when profiles fail, and fills in the details once they can be read', async () => {
		const { gitlab, vitrine } = await start({ groups: [{ path: 'platform', members: [{ ...ada, location: 'London' }] }] });
		gitlab.behave('down-profiles');

		const first = await open(vitrine);

		expect(first).toContain('Ada Lovelace');
		expect(first).toContain('src="http://gitlab.test/ada.png"');
		expect(first).not.toContain('London');
		expect(first).toContain('Details of some Members could not be loaded');
		expect(first).not.toContain('>Members could not be loaded');

		gitlab.behave('up');
		const second = await open(vitrine);

		expect(second).toContain('London');
		expect(second).not.toContain('Details of some Members');
		expect(gitlab.requests.filter((request) => request.startsWith('/api/v4/groups/platform/members/all'))).toHaveLength(1);
	});

	test('keeps the list when GitLab limits the rate of profiles', async () => {
		const { vitrine } = await start({ groups: [{ path: 'platform', members: [{ ...ada, profileStatus: 429 }] }] });

		const html = await open(vitrine);

		expect(html).toContain('Ada Lovelace');
		expect(html).toContain('Details of some Members could not be loaded');
	});

	test('stops reading profiles at the first batch that fails', async () => {
		const members = Array.from({ length: 25 }, (_, index) => ({ id: index + 1, name: `Member ${index}` }));
		const { gitlab, vitrine } = await start({ groups: [{ path: 'platform', members }] });
		gitlab.behave('down-profiles');

		const html = await open(vitrine);

		expect(html).toContain('Member 24');
		expect(gitlab.requests.filter((request) => request.startsWith('/api/v4/users/'))).toHaveLength(10);
	});

	test('reads the other profiles past one GitLab cannot find', async () => {
		const members = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `Member ${index + 10}`, location: `City ${index + 10}` }));
		const { vitrine } = await start({ groups: [{ path: 'platform', members: [{ ...members[0], profileStatus: 404 }, ...members.slice(1)] }] });

		const html = await open(vitrine);

		expect(html).toContain('Member 10');
		expect(html).toContain('City 21');
		expect(html).not.toContain('could not be loaded');
	});

	test('shows the list after one Source timeout when profiles hang', async () => {
		const { gitlab, vitrine } = await start({ groups: [{ path: 'platform', members: [ada] }] });
		gitlab.behave('hanging-profiles');

		const started = Date.now();
		const html = await open(vitrine);

		expect(Date.now() - started).toBeLessThan(15_000);
		expect(html).toContain('Ada Lovelace');
		expect(html).toContain('Details of some Members could not be loaded');
	});

	test('limits a failure to the Members section', async () => {
		const { gitlab, vitrine } = await start({ groups: [{ path: 'platform', members: [ada] }], projects: [{ path: 'platform/api' }] });
		gitlab.behave('down-after-lists');

		const html = await open(vitrine);

		expect(html).toContain('href="/gitlab/platform/-/api"');
		expect(html).toContain('Members could not be loaded');
	});

	test('waits for one Source timeout when Members hang alongside Project details', async () => {
		const { gitlab, vitrine } = await start({ groups: [{ path: 'platform', members: [ada] }], projects: [{ path: 'platform/api' }] });
		gitlab.behave('hanging-after-lists');

		const started = Date.now();
		const html = await open(vitrine);

		expect(Date.now() - started).toBeLessThan(15_000);
		expect(html).toContain('Members could not be loaded');
	});
});

describe('Project cards when GitLab holds something back', () => {
	let gitlab: FakeGitlab;
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		gitlab = await startFakeGitlab({
			groups: [{ path: 'platform' }, { path: 'platform/first' }, { path: 'platform/second' }],
			projects: [
				{ path: 'platform/first/api', topics: ['golang'], contributors: [{ name: 'Ada Lovelace', email: 'ada@example.com', commits: 1 }] },
				...Array.from({ length: 12 }, (_, index) => ({ path: `platform/second/project-${index}` })),
			],
			avatarsRefused: true,
		});
		vitrine = await startVitrine({ sources: [{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform'] }], routes });
	});

	afterAll(async () => {
		await vitrine?.stop();
		await gitlab?.stop();
	});

	afterEach(() => {
		gitlab.behave('up');
	});

	const open = async (path: string) => (await fetch(`${vitrine.url}/gitlab/${path}`)).text();

	test('shows initials when GitLab refuses avatars', async () => {
		const text = textOf(await open('platform/first'));

		expect(text).toContain('AL');
		expect(text).not.toContain('could not be loaded');
	});

	test('warns once, keeps the list and stops asking when Project details fail', async () => {
		await open('platform/first');
		gitlab.behave('down-after-lists');
		const requests = gitlab.requests.length;

		const html = await open('platform/second');

		expect(html).toContain('project-11');
		expect(html.match(/Details of some Projects could not be loaded/g)).toHaveLength(1);
		// The first five cards, of three requests each, out of twelve.
		expect(gitlab.requests.length - requests).toBe(15);
	});

	test('waits for one Source timeout when Project details hang', async () => {
		await open('platform/first');
		gitlab.behave('hanging-after-lists');

		const started = Date.now();
		const html = await open('platform');

		expect(Date.now() - started).toBeLessThan(15_000);
		expect(html).toContain('project-11');
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
