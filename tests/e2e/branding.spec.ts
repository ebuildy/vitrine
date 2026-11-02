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
		sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'] }],
		routes: [
			{ url: '/', controller: 'harbor-images' },
			{ url: '/harbor/:source', controller: 'harbor' },
			{ url: '/harbor/:source/:project', controller: 'harbor-images' },
		],
		branding: { siteName: 'Acme Portal', logo: '/logo.svg' },
		navigation: [{ label: 'Harbor projects', url: '/harbor/main-harbor' }],
		theme: { primary: 'rgb(0, 128, 96)', background: 'rgb(250, 250, 240)', text: 'rgb(30, 30, 60)', border: 'rgb(200, 0, 0)' },
	});
});

test.afterAll(async () => {
	await vitrine?.stop();
	await harbor?.stop();
});

test('a Visitor sees the Branding from Settings', async ({ page }) => {
	await page.route('**/logo.svg', (route) =>
		route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800"/></svg>' }),
	);
	await page.goto(vitrine.url);

	const home = page.getByRole('link', { name: 'Acme Portal' });
	await expect(home).toBeVisible();
	await expect(home).toHaveCSS('font-weight', '700');
	await expect(home).toHaveCSS('text-decoration-line', 'none');

	const logo = home.locator('img');
	await expect(logo).toHaveAttribute('src', '/logo.svg');
	await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(800);
	await expect(logo).toHaveCSS('height', '32px');
});

test('a Visitor follows the Menu from Settings, and the site name back home', async ({ page }) => {
	await page.goto(vitrine.url);

	await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Harbor projects' }).click();
	await expect(page).toHaveURL(`${vitrine.url}/harbor/main-harbor`);

	await page.getByRole('link', { name: 'Acme Portal' }).click();
	await expect(page).toHaveURL(`${vitrine.url}/`);
});

test('a Visitor sees the Theme from Settings', async ({ page }) => {
	await page.goto(`${vitrine.url}/harbor/main-harbor`);

	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 250, 240)');
	await expect(page.locator('body')).toHaveCSS('color', 'rgb(30, 30, 60)');
	await expect(page.getByRole('link', { name: 'Harbor projects' })).toHaveCSS('color', 'rgb(0, 128, 96)');
});

test('a Component uses the Theme from Settings', async ({ page }) => {
	await page.goto(`${vitrine.url}/harbor/main-harbor`);

	const card = page.getByRole('listitem').filter({ hasText: 'platform' });
	await expect(card).toHaveCSS('border-top-color', 'rgb(200, 0, 0)');

	await card.hover();
	await expect(card).toHaveCSS('border-top-color', 'rgb(0, 128, 96)');
});
