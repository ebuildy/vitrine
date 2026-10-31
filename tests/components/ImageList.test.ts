import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import ImageList from '../../src/components/ImageList.astro';
import { startFakeHarbor } from '../support/fake-harbor.ts';
import type { FakeHarbor } from '../support/fake-harbor.ts';
import { writeSettings } from '../support/vitrine.ts';

let harbor: FakeHarbor;

beforeAll(async () => {
	harbor = await startFakeHarbor({
		projects: { platform: ['platform/api'], empty: [], aged: ['aged/api'], kept: ['kept/api'], unreachable: ['unreachable/api'] },
	});
	process.env.VITRINE_SETTINGS = writeSettings({
		sources: [
			{ name: 'main-harbor', type: 'harbor', url: harbor.url },
			{ name: 'five-minute-harbor', type: 'harbor', url: harbor.url, allowedAgeMinutes: 5 },
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

test('says so when a project has no Images', async () => {
	expect(await render({ source: 'main-harbor', project: 'empty' })).toContain('No Images found.');
});

const MINUTE = 60_000;

function requestsFor(project: string) {
	return harbor.requests.filter((request) => request.includes(`/projects/${project}/`));
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
	expect(html).toContain('may be out of date');
});

test('shows an error when the Source is down with nothing cached', async () => {
	harbor.behave('down');

	const html = await render({ source: 'main-harbor', project: 'unreachable' });

	expect(html).toContain('Images could not be loaded');
	expect(html).not.toContain('unreachable/api');
});
