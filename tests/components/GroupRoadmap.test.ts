import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, beforeAll, expect, test } from 'vitest';
import GroupRoadmap from '../../src/components/GroupRoadmap.astro';
import { startFakeGitlab } from '../support/fake-gitlab.ts';
import type { FakeGitlab, FakeGitlabEpic, FakeGitlabOptions } from '../support/fake-gitlab.ts';
import { writeSettings } from '../support/vitrine.ts';

const planned: FakeGitlabEpic[] = [
	{ title: 'Later work', startDate: '2026-03-01', dueDate: '2026-03-31' },
	{ title: 'Early work', startDate: '2026-01-01', dueDate: '2026-01-31' },
	{ title: 'Undated work' },
	{ title: 'Deadline only', dueDate: '2026-02-15' },
	{ title: 'Start only', startDate: '2026-02-01' },
	{ title: 'Leaked plans', confidential: true, startDate: '2026-01-01', dueDate: '2026-01-31' },
	{ title: 'Leaked ideas', confidential: true },
	{ title: 'Finished work', state: 'closed', startDate: '2026-01-01', dueDate: '2026-01-31' },
];

const fakes: FakeGitlab[] = [];

/** A Source of its own, as each Source caches apart. */
async function sourceWith(name: string, options: FakeGitlabOptions, mainGroups = ['platform']) {
	const gitlab = await startFakeGitlab(options);
	fakes.push(gitlab);
	return { name, type: 'gitlab', url: gitlab.url, mainGroups };
}

beforeAll(async () => {
	const sources = await Promise.all([
		sourceWith('main-gitlab', {
			groups: [{ path: 'platform', epics: planned }, { path: 'platform/backend', epics: [{ title: 'Nested work', startDate: '2026-01-05', dueDate: '2026-01-06' }] }],
		}),
		sourceWith('leaky-gitlab', { groups: [{ path: 'platform', epics: planned }], confidentialFilterIgnored: true }),
		sourceWith('busy-gitlab', { groups: [{ path: 'platform', epics: Array.from({ length: 150 }, (_, index) => ({ title: `Epic number ${index}.` })) }] }),
		sourceWith('free-gitlab', { groups: [{ path: 'platform', epics: planned, epicsUnavailable: true }] }),
		sourceWith('quiet-gitlab', { groups: [{ path: 'platform' }] }),
		sourceWith('renamed-gitlab', { groups: [{ path: 'platform', epics: planned, epicTypeName: 'Initiative' }] }),
		sourceWith('failing-gitlab', { groups: [{ path: 'platform' }], graphqlError: 'Field does not exist' }),
		sourceWith('short-gitlab', { groups: [{ path: 'platform', epics: [{ title: 'Quick work', startDate: '2026-06-02', dueDate: '2026-06-03' }] }] }),
		sourceWith('decade-gitlab', { groups: [{ path: 'platform', epics: [{ title: 'Long work', startDate: '2020-01-01', dueDate: '2029-12-31' }] }] }),
		sourceWith('reversed-gitlab', { groups: [{ path: 'platform', epics: [{ title: 'Reversed work', startDate: '2026-02-20', dueDate: '2026-02-10' }] }] }),
		sourceWith('undated-gitlab', { groups: [{ path: 'platform', epics: [{ title: 'Undated work' }] }] }),
	]);
	process.env.VITRINE_SETTINGS = writeSettings({ sources, routes: [] });
});

afterAll(async () => {
	await Promise.all(fakes.map((gitlab) => gitlab.stop()));
});

async function render(source: string, group = 'platform') {
	const container = await AstroContainer.create();
	return container.renderToString(GroupRoadmap, { props: { source, group } });
}

/** What the Gantt shows and what the Unscheduled list shows, with nothing around them. */
async function parts(source: string) {
	const [gantt, unscheduled = ''] = (await render(source)).replace(/<style[\s\S]*?<\/style>/g, '').split('Unscheduled');
	return { gantt, unscheduled };
}

test('shows each dated Epic on the Gantt with its dates and a link to GitLab', async () => {
	const { gantt } = await parts('main-gitlab');

	expect(gantt).toContain('Later work');
	expect(gantt).toContain('2026-03-01');
	expect(gantt).toContain('2026-03-31');
	expect(gantt).toMatch(/href="http:\/\/127\.0\.0\.1:\d+\/groups\/platform\/-\/work_items\/1"/);
});

test('orders the Gantt by start date', async () => {
	const { gantt } = await parts('main-gitlab');

	expect(gantt.indexOf('Early work')).toBeLessThan(gantt.indexOf('Later work'));
});

test('shows Epics with no dates only in the Unscheduled list', async () => {
	const { gantt, unscheduled } = await parts('main-gitlab');

	expect(unscheduled).toContain('Undated work');
	expect(gantt).not.toContain('Undated work');
});

test('leaves the Gantt out when no Epic has dates', async () => {
	const html = await render('undated-gitlab');

	expect(html).toContain('Unscheduled');
	expect(html).not.toContain('class="gantt');
});

test('leaves the Unscheduled list out when every Epic has dates', async () => {
	expect(await render('short-gitlab')).not.toContain('Unscheduled');
});

test.each([
	['a due date', 'Deadline only', 'Due 2026-02-15'],
	['a start date', 'Start only', 'Starts 2026-02-01'],
])('keeps an Epic with only %s on the Gantt', async (_, title, dates) => {
	const { gantt, unscheduled } = await parts('main-gitlab');

	expect(gantt).toContain(title);
	expect(gantt).toContain(dates);
	expect(unscheduled).not.toContain(title);
});

test('marks every month of a short Roadmap', async () => {
	const html = await render('main-gitlab');

	for (const month of ['2026-01', '2026-02', '2026-03']) expect(html).toContain(`>${month}<`);
});

test('marks only some months of a long Roadmap', async () => {
	const html = await render('decade-gitlab');

	expect(html).toContain('>2020-01<');
	expect(html.match(/>20\d\d-\d\d</g)?.length).toBeLessThanOrEqual(8);
});

test('shows an Epic due before it starts, as GitLab can inherit such dates', async () => {
	const html = await render('reversed-gitlab');

	expect(html).toContain('Reversed work');
	expect(html).not.toMatch(/width: *-/);
});

test('includes the Epics of Groups beneath the Main Group', async () => {
	expect(await render('main-gitlab')).toContain('Nested work');
});

test('shows every Epic when they span several pages', async () => {
	expect(await render('busy-gitlab')).toContain('Epic number 149.');
});

test('leaves out closed Epics', async () => {
	expect(await render('main-gitlab')).not.toContain('Finished work');
});

test.each(['main-gitlab', 'leaky-gitlab'])('never shows a confidential Epic, even if GitLab lists it (%s)', async (source) => {
	const html = await render(source);

	expect(html).not.toContain('Leaked plans');
	expect(html).not.toContain('Leaked ideas');
});

test('says that Epics are unavailable when GitLab lists none because the tier has none', async () => {
	const html = await render('free-gitlab');

	expect(html).toContain('role="alert"');
	expect(html).toContain('Epics are not available on free-gitlab');
});

test('tells no Epics apart from Epics being unavailable', async () => {
	const html = await render('quiet-gitlab');

	expect(html).toContain('No open Epics.');
	expect(html).not.toContain('role="alert"');
});

test('shows the Epics of a GitLab that renamed the type', async () => {
	expect(await render('renamed-gitlab')).toContain('Later work');
});

test('shows an error when GitLab answers the query with errors', async () => {
	expect(await render('failing-gitlab')).toContain('Epics could not be loaded');
});

test.each([
	['a Group beneath a Main Group', 'platform/backend'],
	['a Group outside the Main Groups', 'other'],
])('shows an error for %s, as a Roadmap belongs to a Main Group', async (_, group) => {
	expect(await render('main-gitlab', group)).toContain('Epics could not be loaded');
});
