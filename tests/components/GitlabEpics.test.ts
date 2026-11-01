import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, beforeAll, expect, test } from 'vitest';
import GitlabEpics from '../../src/components/GitlabEpics.astro';
import { startFakeGitlab } from '../support/fake-gitlab.ts';
import type { FakeGitlab, FakeGitlabEpic } from '../support/fake-gitlab.ts';
import { writeSettings } from '../support/vitrine.ts';

const detailed: FakeGitlabEpic[] = [
	{
		title: 'Faster checkout',
		description: 'Cut the **time to pay**.\n\n![Plan](/uploads/abc/plan.png)\n\n[Notes](/uploads/abc/notes.md)\n\n<script>alert(1)</script>',
		assignees: [{ name: 'Ada Lovelace', avatarUrl: '/uploads/-/system/user/avatar/1/avatar.png' }, { name: 'Grace Hopper' }],
		weight: 8,
		rolledUpWeight: 21,
		issues: { all: 4, closed: 1 },
	},
	{ title: 'Rolled up work', rolledUpWeight: 13, issues: { all: 1, closed: 1 } },
	{ title: 'Bare work' },
	{ title: 'Leaked plans', confidential: true, description: 'Rotate the key' },
];

let gitlab: FakeGitlab;

beforeAll(async () => {
	gitlab = await startFakeGitlab({ groups: [{ path: 'platform', epics: detailed }, { path: 'free', epicsUnavailable: true }, { path: 'quiet' }] });
	const source = { name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform', 'free', 'quiet'] };
	process.env.VITRINE_SETTINGS = writeSettings({ sources: [source], routes: [] });
});

afterAll(async () => {
	await gitlab.stop();
});

async function render(group = 'platform') {
	const container = await AstroContainer.create();
	return (await container.renderToString(GitlabEpics, { props: { source: 'main-gitlab', group } })).replace(/<style[\s\S]*?<\/style>/g, '');
}

/** What the page holds for one Epic, as the fields of one Epic must not be read from another. */
async function epic(title: string) {
	const items = (await render()).split('<li class="epic"');
	return items.find((item) => item.includes(title)) ?? '';
}

test('links each Epic to GitLab by its title', async () => {
	expect(await epic('Faster checkout')).toMatch(/href="http:\/\/127\.0\.0\.1:\d+\/groups\/platform\/-\/work_items\/1"/);
});

test('renders the description as Markdown, with nothing in it able to run', async () => {
	const html = await epic('Faster checkout');

	expect(html).toContain('<strong>time to pay</strong>');
	expect(html).not.toContain('<script');
});

test('points the links and images of a description at the Group of the Epic in GitLab', async () => {
	const html = await epic('Faster checkout');

	expect(html).toContain(`src="${gitlab.url}/groups/platform/-/uploads/abc/plan.png"`);
	expect(html).toContain(`href="${gitlab.url}/groups/platform/-/uploads/abc/notes.md"`);
});

test('shows assignees by avatar, on the Source as GitLab answers avatars with a path', async () => {
	const html = await epic('Faster checkout');

	expect(html).toContain(`src="${gitlab.url}/uploads/-/system/user/avatar/1/avatar.png"`);
	expect(html).toContain('alt="Ada Lovelace"');
});

test('names an assignee with no avatar', async () => {
	expect(await epic('Faster checkout')).toContain('title="Grace Hopper"');
});

test('shows progress as the share of its Issues that are closed', async () => {
	const html = await epic('Faster checkout');

	expect(html).toContain('<progress value="1" max="4"');
	expect(html).toContain('25%');
});

test('counts the Issues of an Epic, in the singular for one', async () => {
	expect(await epic('Faster checkout')).toContain('4 Issues');
	expect(await epic('Rolled up work')).toContain('1 Issue<');
});

test('shows the weight set on an Epic over the weight of its Issues', async () => {
	expect(await epic('Faster checkout')).toContain('Weight 8');
});

test('falls back on the weight of its Issues', async () => {
	expect(await epic('Rolled up work')).toContain('Weight 13');
});

test('leaves blank what an Epic does not have', async () => {
	const html = await epic('Bare work');

	expect(html).toContain('0 Issues');
	expect(html).not.toContain('<progress');
	expect(html).not.toContain('Weight');
	expect(html).not.toContain('<img');
});

test('never shows a confidential Epic', async () => {
	const html = await render();

	expect(html).not.toContain('Leaked plans');
	expect(html).not.toContain('Rotate the key');
});

test('says so on a tier without Epics', async () => {
	expect(await render('free')).toContain('they need a GitLab tier');
});

test('says so when a Group has no Epics', async () => {
	expect(await render('quiet')).toContain('No open Epics.');
});

test('says so for a Group that is not a Main Group', async () => {
	expect(await render('platform/backend')).toContain('platform/backend is not a Main Group of main-gitlab');
});
