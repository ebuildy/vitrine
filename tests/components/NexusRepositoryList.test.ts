import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import NexusRepositoryList from '../../src/components/NexusRepositoryList.astro';
import { startFakeNexus } from '../support/fake-nexus.ts';
import type { FakeNexus } from '../support/fake-nexus.ts';
import { writeSettings } from '../support/vitrine.ts';

let nexus: FakeNexus;
let emptyNexus: FakeNexus;

beforeAll(async () => {
	emptyNexus = await startFakeNexus({ repositories: [] });
	nexus = await startFakeNexus({
		repositories: [
			{ name: 'maven-releases', format: 'maven2', type: 'hosted' },
			{ name: 'npm-proxy', format: 'npm', type: 'proxy' },
			{ name: 'docker-all', format: 'docker', type: 'group' },
		],
	});
	process.env.VITRINE_SETTINGS = writeSettings({
		sources: [
			{ name: 'main-nexus', type: 'nexus', url: nexus.url },
			{ name: 'path-nexus', type: 'nexus', url: `${nexus.url}/nexus` },
			{ name: 'selected-nexus', type: 'nexus', url: nexus.url, repositories: ['npm-proxy', 'gone'] },
			{ name: 'stale-nexus', type: 'nexus', url: nexus.url, allowedAgeMinutes: 5 },
			{ name: 'fresh-nexus', type: 'nexus', url: nexus.url },
			{ name: 'empty-nexus', type: 'nexus', url: emptyNexus.url },
		],
		routes: [],
	});
});

afterAll(async () => {
	await nexus?.stop();
	await emptyNexus?.stop();
});

afterEach(() => {
	vi.useRealTimers();
	nexus.behave('up');
});

async function render(props: { source: string; maxItems?: number }) {
	const container = await AstroContainer.create();
	return container.renderToString(NexusRepositoryList, { props });
}

/** What a Visitor reads, with the markup left out. */
function textOf(html: string) {
	return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

test('shows the name, format and type of each Repository', async () => {
	const text = textOf(await render({ source: 'main-nexus' }));

	expect(text).toContain('maven-releases Format maven2 Type hosted');
	expect(text).toContain('npm-proxy Format npm Type proxy');
	expect(text).toContain('docker-all Format docker Type group');
});

test('links each Repository to its page in Nexus', async () => {
	const html = await render({ source: 'main-nexus' });

	expect(html).toContain(`href="${nexus.url}/#browse/browse:maven-releases"`);
	expect(html).toContain(`href="${nexus.url}/#browse/browse:npm-proxy"`);
});

test('keeps the path of a Nexus served under one', async () => {
	expect(await render({ source: 'path-nexus' })).toContain(`href="${nexus.url}/nexus/#browse/browse:maven-releases"`);
	expect(nexus.requests).toContain('/nexus/service/rest/v1/repositories');
});

test('shows only the Repositories Published in Settings', async () => {
	const text = textOf(await render({ source: 'selected-nexus' }));

	expect(text).toContain('npm-proxy');
	expect(text).not.toContain('maven-releases');
	expect(text).not.toContain('gone');
});

test('shows at most maxItems Repositories', async () => {
	const text = textOf(await render({ source: 'main-nexus', maxItems: 2 }));

	expect(text).toContain('npm-proxy');
	expect(text).not.toContain('docker-all');
});

test('says so when the Source has no Repositories', async () => {
	expect(await render({ source: 'empty-nexus' })).toContain('No Repositories found.');
});

test('warns when showing Stale Repositories because the Source is down', async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	await render({ source: 'stale-nexus' });

	vi.advanceTimersByTime(6 * 60_000);
	nexus.behave('down');
	const html = await render({ source: 'stale-nexus' });

	expect(html).toContain('maven-releases');
	expect(html).toContain('This list is Stale');
});

test('shows an error when the Source is down with nothing cached', async () => {
	nexus.behave('down');

	expect(await render({ source: 'fresh-nexus' })).toContain('Repositories could not be loaded because fresh-nexus is down.');
});
