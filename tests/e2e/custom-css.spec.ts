import { expect, test } from '@playwright/test';
import { startVitrine } from '../support/vitrine.ts';
import type { RunningVitrine } from '../support/vitrine.ts';

let vitrine: RunningVitrine;

test.beforeAll(async () => {
	vitrine = await startVitrine(
		{
			sources: [],
			routes: [{ url: '/', controller: 'harbor-images' }],
			theme: {
				name: 'naval',
				css: ['https://cdn.acme.test/brand.css', './brand.css', 'body { color: rgb(0, 0, 200); }'],
			},
		},
		{},
		{ 'brand.css': '.site-name { letter-spacing: 3px; }' },
	);
});

test.afterAll(async () => {
	await vitrine?.stop();
});

test('a Visitor sees the CSS of Settings win over Vitrine and its named Theme', async ({ page }) => {
	await page.route('https://cdn.acme.test/brand.css', (route) => route.fulfill({ contentType: 'text/css', body: 'body { background-color: rgb(255, 240, 200); }' }));
	await page.goto(vitrine.url);

	// From a remote stylesheet, a local file and code written in Settings.
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 240, 200)');
	await expect(page.locator('.site-name')).toHaveCSS('letter-spacing', '3px');
	await expect(page.locator('body')).toHaveCSS('color', 'rgb(0, 0, 200)');
});
