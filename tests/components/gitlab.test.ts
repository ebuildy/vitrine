import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import GitlabCommitList from '../../src/components/GitlabCommitList.astro';
import GitlabContributorList from '../../src/components/GitlabContributorList.astro';
import GitlabGroupList from '../../src/components/GitlabGroupList.astro';
import GitlabGroupSummary from '../../src/components/GitlabGroupSummary.astro';
import GitlabIssueList from '../../src/components/GitlabIssueList.astro';
import GitlabProjectList from '../../src/components/GitlabProjectList.astro';
import GitlabProjectSummary from '../../src/components/GitlabProjectSummary.astro';
import GitlabReadme from '../../src/components/GitlabReadme.astro';
import GitlabReleaseList from '../../src/components/GitlabReleaseList.astro';
import GroupMembers from '../../src/components/GroupMembers.astro';
import { startFakeGitlab } from '../support/fake-gitlab.ts';
import type { FakeGitlab } from '../support/fake-gitlab.ts';
import { writeSettings } from '../support/vitrine.ts';

let gitlab: FakeGitlab;
let emptyGitlab: FakeGitlab;

const project = {
	path: 'platform/api',
	readme: '# Hello',
	commits: [{ title: 'Add login', author_name: 'Ada', committed_date: '2026-09-15T08:00:00.000Z', web_url: 'http://gitlab.test/c' }],
	issues: [{ title: 'Fix login', state: 'opened', confidential: false, web_url: 'http://gitlab.test/i', assignees: [], labels: [] }],
	releases: [{ name: 'Spring', tag_name: 'v1', released_at: '2026-03-20T08:00:00.000Z' }],
	contributors: [{ name: 'Ada', email: 'ada@example.com', commits: 1 }],
};

const onGroup = { props: { group: 'platform' } };
const onProject = { props: { project: 'platform/api' } };
/** Every Component, with what it shows normally, the start of its error, and what it shows when empty. */
const components = [
	{ name: 'GitlabGroupSummary', component: GitlabGroupSummary, ...onGroup, shown: 'View in GitLab', error: 'This Group could not be loaded', none: undefined },
	{ name: 'GitlabGroupList', component: GitlabGroupList, ...onGroup, shown: 'backend', error: 'Subgroups could not be loaded', none: undefined },
	{ name: 'GitlabProjectList', component: GitlabProjectList, ...onGroup, shown: 'api', error: 'Projects could not be loaded', none: undefined },
	{ name: 'GroupMembers', component: GroupMembers, ...onGroup, shown: 'Ada Lovelace', error: 'Members could not be loaded', none: 'No Members found.' },
	{ name: 'GitlabProjectSummary', component: GitlabProjectSummary, ...onProject, shown: 'View in GitLab', error: 'This Project could not be loaded', none: undefined },
	{ name: 'GitlabReadme', component: GitlabReadme, ...onProject, shown: 'Hello', error: 'The README could not be loaded', none: 'No README found.' },
	{ name: 'GitlabCommitList', component: GitlabCommitList, ...onProject, shown: 'Add login', error: 'Commits could not be loaded', none: 'No commits found.' },
	{ name: 'GitlabIssueList', component: GitlabIssueList, ...onProject, shown: 'Fix login', error: 'Issues could not be loaded', none: 'No open Issues.' },
	{ name: 'GitlabReleaseList', component: GitlabReleaseList, ...onProject, shown: 'Spring', error: 'Releases could not be loaded', none: 'No releases found.' },
	{ name: 'GitlabContributorList', component: GitlabContributorList, ...onProject, shown: 'Ada', error: 'Contributors could not be loaded', none: 'No contributors found.' },
];

const gitlabSource = (name: string, url: string, allowedAgeMinutes?: number) => ({ name, type: 'gitlab', url, mainGroups: ['platform'], allowedAgeMinutes });

beforeAll(async () => {
	gitlab = await startFakeGitlab({
		groups: [
			{
				path: 'platform',
				members: [{ id: 1, name: 'Ada Lovelace' }, ...Array.from({ length: 120 }, (_, index) => ({ id: index + 2, name: `Person ${index}` }))],
			},
			{ path: 'platform/backend', members: [{ id: 200, name: 'Grace Hopper' }] },
			{ path: 'platform/frontend', members: [{ id: 201, name: 'Linus Torvalds' }] },
		],
		projects: [
			{ ...project, members: [{ id: 202, name: 'Katherine Johnson' }] },
			...Array.from({ length: 149 }, (_, index) => ({ path: `platform/backend/extra-${index}` })),
		],
	});
	emptyGitlab = await startFakeGitlab({ groups: [{ path: 'platform' }, { path: 'platform/quiet' }], projects: [{ path: 'platform/api' }] });
	process.env.VITRINE_SETTINGS = writeSettings({
		sources: [
			gitlabSource('main-gitlab', gitlab.url),
			gitlabSource('empty-gitlab', emptyGitlab.url),
			gitlabSource('stale-details', gitlab.url, 5),
			...components.flatMap(({ name }) => [gitlabSource(`stale-${name}`, gitlab.url, 5), gitlabSource(`down-${name}`, gitlab.url)]),
		],
		routes: [
			{ url: '/gitlab/:group+', controller: 'gitlab-group' },
			{ url: '/gitlab/:group+/-/:project', controller: 'gitlab-project' },
		],
	});
});

afterAll(async () => {
	await gitlab?.stop();
	await emptyGitlab?.stop();
});

afterEach(() => {
	vi.useRealTimers();
	gitlab.behave('up');
});

async function render(component: (typeof components)[number]['component'], props: Record<string, string | boolean>) {
	const container = await AstroContainer.create();
	return container.renderToString(component, { props });
}

describe.each(components)('$name', ({ name, component, props, shown, error, none }) => {
	test('shows its content', async () => {
		expect(await render(component, { source: 'main-gitlab', ...props })).toContain(shown);
	});

	test('warns when showing Stale content because the Source is down', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		await render(component, { source: `stale-${name}`, ...props });

		vi.advanceTimersByTime(6 * 60_000);
		gitlab.behave('down');
		const html = await render(component, { source: `stale-${name}`, ...props });

		expect(html).toContain(shown);
		expect(html).toContain('Stale');
	});

	test('shows an error when the Source is down with nothing cached', async () => {
		gitlab.behave('down');

		expect(await render(component, { source: `down-${name}`, ...props })).toContain(error);
	});

	test.runIf(none !== undefined)('says so when it has nothing to show', async () => {
		expect(await render(component, { source: 'empty-gitlab', ...props })).toContain(none as string);
	});
});

test('leaves the subgroups out entirely when a Group has none', async () => {
	expect(await render(GitlabGroupList, { source: 'empty-gitlab', group: 'platform/quiet' })).not.toContain('Subgroups');
});

test('says so when a Group has no Projects', async () => {
	expect(await render(GitlabProjectList, { source: 'empty-gitlab', group: 'platform/quiet' })).toContain('No Projects found.');
});

test('shows every Project when they span several API pages', async () => {
	expect(await render(GitlabProjectList, { source: 'main-gitlab', group: 'platform' })).toContain('href="/gitlab/platform/backend/-/extra-148"');
});

test('shows every Member when they span several API pages', async () => {
	expect(await render(GroupMembers, { source: 'main-gitlab', group: 'platform' })).toContain('Person 119');
});

test('shows only the Members of the Group unless deep', async () => {
	const html = await render(GroupMembers, { source: 'main-gitlab', group: 'platform' });

	expect(html).toContain('Ada Lovelace');
	expect(html).not.toContain('Grace Hopper');
	expect(html).not.toContain('Katherine Johnson');
});

test('shows the Members of every Group and Project beneath the Main Group when deep, each once', async () => {
	const html = await render(GroupMembers, { source: 'main-gitlab', group: 'platform', deep: true });

	for (const name of ['Grace Hopper', 'Linus Torvalds', 'Katherine Johnson']) expect(html).toContain(name);
	expect(html.match(/Ada Lovelace/g)).toHaveLength(1);
});

test('shows a subgroup with the Members at or beneath it, and those it inherits, when deep', async () => {
	const html = await render(GroupMembers, { source: 'main-gitlab', group: 'platform/backend', deep: true });

	expect(html).toContain('Ada Lovelace');
	expect(html).toContain('Grace Hopper');
	expect(html).not.toContain('Linus Torvalds');
});

test('keeps the deep list apart from the list of the Group', async () => {
	const props = { source: 'main-gitlab', group: 'platform' };

	await render(GroupMembers, { ...props, deep: true });
	expect(await render(GroupMembers, props)).not.toContain('Grace Hopper');
	expect(await render(GroupMembers, { ...props, deep: true })).toContain('Grace Hopper');
});

test('warns when the details of some Members are Stale because the Source cannot give them', async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	await render(GroupMembers, { source: 'stale-details', group: 'platform' });

	vi.advanceTimersByTime(6 * 60_000);
	gitlab.behave('down-profiles');
	const html = await render(GroupMembers, { source: 'stale-details', group: 'platform' });

	expect(html).toContain('Details of some Members are Stale');
	expect(html).not.toContain('This list is Stale');
});

test('shows an error for a Group outside the Main Groups', async () => {
	expect(await render(GroupMembers, { source: 'main-gitlab', group: 'other' })).toContain('Members could not be loaded');
});

test.each([
	['Group', GitlabGroupSummary, { group: 'platform/missing' }],
	['Project', GitlabProjectSummary, { project: 'platform/missing' }],
])('says so when a %s does not exist', async (kind, component, props) => {
	expect(await render(component, { source: 'main-gitlab', ...props })).toContain(`${kind} platform/missing was not found`);
});

test('shows an error for a path outside the Main Groups', async () => {
	expect(await render(GitlabCommitList, { source: 'main-gitlab', project: 'other/api' })).toContain('Commits could not be loaded');
});

test('never reads content about a Project the Main Group does not list', async () => {
	expect(await render(GitlabReadme, { source: 'main-gitlab', project: 'platform/missing' })).toContain('The README could not be loaded');
});
