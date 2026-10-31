import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import HarborProjectList from '../../src/components/HarborProjectList.astro';
import { startFakeHarbor } from '../support/fake-harbor.ts';
import type { FakeHarbor } from '../support/fake-harbor.ts';
import { writeSettings } from '../support/vitrine.ts';

let harbor: FakeHarbor;
let emptyHarbor: FakeHarbor;

const details = (storage?: number) => ({
	creation_time: '2025-03-14T08:00:00.000Z',
	repo_count: 12,
	...(storage === undefined ? {} : { summary: { quota: { used: { storage } } } }),
});

beforeAll(async () => {
	harbor = await startFakeHarbor({
		projects: { platform: [], data: [], ...Object.fromEntries(Array.from({ length: 149 }, (_, index) => [`extra-${index}`, []])) },
		projectDetails: { platform: details(1_610_612_736), data: details() },
	});
	emptyHarbor = await startFakeHarbor({ projects: {} });
	process.env.VITRINE_SETTINGS = writeSettings({
		sources: [
			{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['unrelated'] },
			{ name: 'fresh-harbor', type: 'harbor', url: harbor.url, projects: ['unrelated'] },
			{ name: 'stale-harbor', type: 'harbor', url: harbor.url, projects: ['unrelated'], allowedAgeMinutes: 5 },
			{ name: 'summary-harbor', type: 'harbor', url: harbor.url, projects: ['unrelated'], allowedAgeMinutes: 0 },
			{ name: 'empty-harbor', type: 'harbor', url: emptyHarbor.url, projects: ['unrelated'] },
		],
		routes: [{ url: '/registry/:source/:project', controller: 'harbor-images' }],
	});
});

afterAll(async () => {
	await harbor?.stop();
	await emptyHarbor?.stop();
});

afterEach(() => {
	vi.useRealTimers();
	harbor.behave('up');
});

async function render(props: { source: string }) {
	const container = await AstroContainer.create();
	return container.renderToString(HarborProjectList, { props });
}

/** What a Visitor reads, with the markup left out. */
function textOf(html: string) {
	return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

test('links each Harbor project of the Source to its Images', async () => {
	const html = await render({ source: 'main-harbor' });

	expect(html).toContain('href="/registry/main-harbor/platform"');
	expect(html).toContain('href="/registry/main-harbor/data"');
	expect(html).not.toContain('unrelated');
});

test('shows every Harbor project when they span several API pages', async () => {
	expect(await render({ source: 'main-harbor' })).toContain('href="/registry/main-harbor/extra-148"');
});

test('shows the repository count, creation date and storage used of a Harbor project', async () => {
	expect(textOf(await render({ source: 'main-harbor' }))).toContain('platform Repositories 12 Created 2025-03-14 Storage used 1.5 GiB');
});

test('leaves out the storage used when Harbor refuses it', async () => {
	const text = textOf(await render({ source: 'main-harbor' }));

	expect(text).toContain('data Repositories 12 Created 2025-03-14 extra-0');
});

test('says so when the Source has no Harbor projects', async () => {
	expect(await render({ source: 'empty-harbor' })).toContain('No Harbor projects found.');
});

test('warns when showing Stale Harbor projects because the Source is down', async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	await render({ source: 'stale-harbor' });

	vi.advanceTimersByTime(6 * 60_000);
	harbor.behave('down');
	const html = await render({ source: 'stale-harbor' });

	expect(html).toContain('platform');
	expect(html).toContain('This list is Stale');
});

test('shows an error when the Source is down with nothing cached', async () => {
	harbor.behave('down');

	expect(await render({ source: 'fresh-harbor' })).toContain('Harbor projects could not be loaded');
});

test('counts the Source as down when a summary fails for any reason but a refusal', async () => {
	harbor.behave('down-after-projects');

	expect(await render({ source: 'summary-harbor' })).toContain('Harbor projects could not be loaded');
});
