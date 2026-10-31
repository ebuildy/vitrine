import { expect, test } from '@playwright/test';
import { startFakeHarbor } from '../support/fake-harbor.ts';
import type { FakeHarbor } from '../support/fake-harbor.ts';
import { startVitrine } from '../support/vitrine.ts';
import type { RunningVitrine } from '../support/vitrine.ts';

let harbor: FakeHarbor;
let vitrine: RunningVitrine;

test.beforeAll(async () => {
	harbor = await startFakeHarbor({
		projects: { platform: ['platform/api'] },
		artifacts: {
			'platform/api': [
				{
					size: 52_428_800,
					push_time: '2026-10-01T08:00:00.000Z',
					tags: [
						{ name: '1.2.0', push_time: '2026-10-01T08:00:00.000Z' },
						{ name: '1.1.0', push_time: '2026-09-01T08:00:00.000Z' },
					],
				},
			],
		},
	});
	vitrine = await startVitrine({
		sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'] }],
		routes: [{ url: '/images', controller: 'harbor-images' }],
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

test('a Visitor copies the pull command of a tag', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto(`${vitrine.url}/images`);

	const row = page.getByRole('row', { name: /^1\.1\.0/ });
	await row.getByRole('button', { name: 'Copy' }).click();

	await expect(row.getByRole('button', { name: 'Copied' })).toBeVisible();
	const clipboard = await page.evaluate(() => navigator.clipboard.readText());
	expect(clipboard).toBe(`docker pull ${new URL(harbor.url).host}/platform/api:1.1.0`);
});
