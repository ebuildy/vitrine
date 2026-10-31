import { expect, test } from '@playwright/test';
import { startFakeHarbor } from '../support/fake-harbor.ts';
import type { FakeHarbor } from '../support/fake-harbor.ts';
import { startVitrine } from '../support/vitrine.ts';
import type { RunningVitrine } from '../support/vitrine.ts';

let harbor: FakeHarbor;
let vitrine: RunningVitrine;

test.beforeAll(async () => {
	harbor = await startFakeHarbor({ projects: { platform: ['platform/api'] } });
	vitrine = await startVitrine({
		sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url }],
		routes: [{ url: '/images', controller: 'harbor-images', params: { source: 'main-harbor', project: 'platform' } }],
	});
});

test.afterAll(async () => {
	await vitrine?.stop();
	await harbor?.stop();
});

test('a Visitor opens a Route and sees its Images', async ({ page }) => {
	await page.goto(`${vitrine.url}/images`);

	await expect(page.getByRole('heading', { name: 'Images' })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'platform/api' })).toBeVisible();
});
