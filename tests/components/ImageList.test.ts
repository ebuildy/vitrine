import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, beforeAll, expect, test } from 'vitest';
import ImageList from '../../src/components/ImageList.astro';
import { startFakeHarbor } from '../support/fake-harbor.ts';
import type { FakeHarbor } from '../support/fake-harbor.ts';
import { writeSettings } from '../support/vitrine.ts';

let harbor: FakeHarbor;

beforeAll(async () => {
	harbor = await startFakeHarbor({ projects: { platform: ['platform/api'], empty: [] } });
	process.env.VITRINE_SETTINGS = writeSettings({
		sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url }],
		routes: [],
	});
});

afterAll(async () => {
	await harbor?.stop();
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
