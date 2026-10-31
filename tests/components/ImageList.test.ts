import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import ImageList from '../../src/components/ImageList.astro';
import { startFakeHarbor } from '../support/fake-harbor.ts';
import type { FakeHarbor } from '../support/fake-harbor.ts';
import { writeSettings } from '../support/vitrine.ts';

let harbor: FakeHarbor;

beforeAll(async () => {
	harbor = await startFakeHarbor({
		projects: {
			platform: ['platform/api'],
			empty: [],
			aged: ['aged/api'],
			kept: ['kept/api'],
			unreachable: ['unreachable/api'],
			tagged: ['tagged/api'],
			nested: ['nested/team/api'],
			long: ['long/api'],
		},
		artifacts: {
			'nested/team/api': [{ size: 1, push_time: '2026-10-01T08:00:00.000Z', tags: [{ name: '1.0', push_time: '2026-10-01T08:00:00.000Z' }] }],
			'long/api': Array.from({ length: 150 }, (_, index) => ({
				size: 1,
				push_time: '2026-10-01T08:00:00.000Z',
				tags: [{ name: `tag-${index}`, push_time: '2026-10-01T08:00:00.000Z' }],
			})),
			'tagged/api': [
				{
					size: 52_428_800,
					push_time: '2026-09-01T08:00:00.000Z',
					tags: [
						{ name: '1.2.0', push_time: '2026-10-01T08:00:00.000Z' },
						{ name: 'stable', push_time: '2026-10-03T08:00:00.000Z' },
					],
					scan_overview: {
						'application/vnd.security.vulnerability.report; version=1.1': {
							scan_status: 'Success',
							end_time: '2026-10-04T09:00:00.000Z',
							summary: { total: 11, fixable: 2, summary: { Critical: 1, High: 2, Medium: 3, Low: 5 } },
						},
					},
				},
				{ size: 1_610_612_736, push_time: '2026-08-01T08:00:00.000Z', tags: [{ name: '1.1.0', push_time: '2026-08-01T08:00:00.000Z' }] },
				{
					size: 1024,
					push_time: '2026-06-01T08:00:00.000Z',
					tags: [{ name: 'clean', push_time: '2026-06-01T08:00:00.000Z' }],
					scan_overview: {
						'application/vnd.security.vulnerability.report; version=1.1': {
							scan_status: 'Success',
							end_time: '2026-06-02T09:00:00.000Z',
							summary: { total: 0, fixable: 0, summary: null },
						},
					},
				},
				{
					size: 1024,
					push_time: '2026-05-01T08:00:00.000Z',
					tags: [{ name: 'broken', push_time: '2026-05-01T08:00:00.000Z' }],
					scan_overview: {
						'application/vnd.security.vulnerability.report; version=1.1': { scan_status: 'Error', end_time: '2026-05-02T09:00:00.000Z' },
					},
				},
				{ size: 512, push_time: '2026-07-01T08:00:00.000Z', tags: null },
			],
		},
	});
	process.env.ROBOT_PASSWORD = 's3cret';
	process.env.VITRINE_SETTINGS = writeSettings({
		sources: [
			{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'] },
			{ name: 'five-minute-harbor', type: 'harbor', url: harbor.url, projects: ['platform'], allowedAgeMinutes: 5 },
			{ name: 'robot-harbor', type: 'harbor', url: harbor.url, projects: ['platform'], username: 'robot', passwordEnv: 'ROBOT_PASSWORD' },
		],
		routes: [],
	});
});

afterAll(async () => {
	await harbor?.stop();
});

afterEach(() => {
	vi.useRealTimers();
	harbor.behave('up');
});

async function render(props: { source: string; project: string }) {
	const container = await AstroContainer.create();
	return container.renderToString(ImageList, { props });
}

test('loads and lists Images from props alone', async () => {
	expect(await render({ source: 'main-harbor', project: 'platform' })).toContain('platform/api');
});

/** What a Visitor reads, one tag row per line, with the markup left out. */
function textOf(html: string) {
	return html
		.replace(/<\/tr>/g, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/[^\S\n]+/g, ' ');
}

test('shows the size and push date of each tag', async () => {
	const text = textOf(await render({ source: 'main-harbor', project: 'tagged' }));

	expect(text).toContain('tagged/api');
	expect(text).toContain('1.2.0 50 MiB 2026-10-01');
	expect(text).toContain('stable 50 MiB 2026-10-03');
	expect(text).toContain('1.1.0 1.5 GiB 2026-08-01');
});

test('shows the scan severity counts and scan date of each tag', async () => {
	const text = textOf(await render({ source: 'main-harbor', project: 'tagged' }));

	expect(text).toContain('1.2.0 50 MiB 2026-10-01 1 2 3 5 2026-10-04');
	expect(text).toContain('stable 50 MiB 2026-10-03 1 2 3 5 2026-10-04');
	expect(text).toContain('clean 1 KiB 2026-06-01 0 0 0 0 2026-06-02');
});

test.each([
	['was never scanned', '1.1.0 1.5 GiB 2026-08-01 Not scanned'],
	['has a failed scan', 'broken 1 KiB 2026-05-01 Not scanned'],
])('says so when a tag %s', async (_, row) => {
	expect(textOf(await render({ source: 'main-harbor', project: 'tagged' }))).toContain(row);
});

test('offers a pull command for each tag, without the scheme of the Source', async () => {
	const text = textOf(await render({ source: 'main-harbor', project: 'tagged' }));
	const { host } = new URL(harbor.url);

	expect(text).toContain(`stable 50 MiB 2026-10-03 1 2 3 5 2026-10-04 docker pull ${host}/tagged/api:stable`);
	expect(text).toContain(`1.1.0 1.5 GiB 2026-08-01 Not scanned docker pull ${host}/tagged/api:1.1.0`);
});

test('shows Images from a nested repository', async () => {
	const text = textOf(await render({ source: 'main-harbor', project: 'nested' }));

	expect(text).toContain(`docker pull ${new URL(harbor.url).host}/nested/team/api:1.0`);
});

test('shows every tag when a repository spans several API pages', async () => {
	const html = await render({ source: 'main-harbor', project: 'long' });

	expect(html).toContain('tag-0<');
	expect(html).toContain('tag-149<');
});

test('presents a Source with credentials and one without in the same way', async () => {
	const anonymous = await render({ source: 'main-harbor', project: 'tagged' });

	expect(await render({ source: 'robot-harbor', project: 'tagged' })).toBe(anonymous);
});

test('says so when an Image has no tags', async () => {
	expect(await render({ source: 'main-harbor', project: 'platform' })).toContain('No tags.');
});

test('says so when a project has no Images', async () => {
	expect(await render({ source: 'main-harbor', project: 'empty' })).toContain('No Images found.');
});

const MINUTE = 60_000;

function requestsFor(project: string) {
	return harbor.repositoryListRequests().filter((request) => request.includes(`/projects/${project}/`));
}

test.each([
	['defaults to 15 minutes', 'main-harbor', 15],
	['is set per Source in Settings', 'five-minute-harbor', 5],
])('the allowed age %s', async (_, source, minutes) => {
	vi.useFakeTimers({ toFake: ['Date'] });
	const before = requestsFor('aged').length;

	await render({ source, project: 'aged' });
	vi.advanceTimersByTime(minutes * MINUTE - 1);
	await render({ source, project: 'aged' });
	expect(requestsFor('aged')).toHaveLength(before + 1);

	vi.advanceTimersByTime(1);
	await render({ source, project: 'aged' });
	expect(requestsFor('aged')).toHaveLength(before + 2);
});

test('warns when showing Stale Images because the Source is down', async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	await render({ source: 'five-minute-harbor', project: 'kept' });

	vi.advanceTimersByTime(365 * 24 * 60 * MINUTE);
	harbor.behave('down');
	const html = await render({ source: 'five-minute-harbor', project: 'kept' });

	expect(html).toContain('kept/api');
	expect(html).toContain('This list is Stale');
});

test('shows an error when the Source is down with nothing cached', async () => {
	harbor.behave('down');

	const html = await render({ source: 'main-harbor', project: 'unreachable' });

	expect(html).toContain('Images could not be loaded');
	expect(html).not.toContain('unreachable/api');
});
