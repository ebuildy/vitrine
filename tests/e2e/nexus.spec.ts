import { expect, test } from '@playwright/test';
import { startFakeNexus } from '../support/fake-nexus.ts';
import type { FakeNexus } from '../support/fake-nexus.ts';
import { startVitrine } from '../support/vitrine.ts';
import type { RunningVitrine } from '../support/vitrine.ts';

let nexus: FakeNexus;
let vitrine: RunningVitrine;

test.beforeAll(async () => {
	nexus = await startFakeNexus({
		repositories: [
			{ name: 'maven-releases', format: 'maven2', type: 'hosted' },
			{ name: 'npm-proxy', format: 'npm', type: 'proxy' },
		],
	});
	vitrine = await startVitrine({
		sources: [{ name: 'main-nexus', type: 'nexus', url: nexus.url }],
		routes: [{ url: '/nexus/:source', controller: 'nexus' }],
	});
});

test.afterAll(async () => {
	await vitrine?.stop();
	await nexus?.stop();
});

test('a Visitor opens a Nexus Route and follows a Repository into Nexus', async ({ page }) => {
	await page.goto(`${vitrine.url}/nexus/main-nexus`);

	await expect(page.getByRole('heading', { name: 'main-nexus', level: 1 })).toBeVisible();
	const card = page.getByRole('listitem').filter({ hasText: 'npm-proxy' });
	await expect(card).toContainText('npm');
	await expect(card).toContainText('proxy');

	await card.click();

	await expect(page).toHaveURL(`${nexus.url}/#browse/browse:npm-proxy`);
});
