import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startFakeHarbor } from '../support/fake-harbor.ts';
import type { FakeHarbor } from '../support/fake-harbor.ts';
import { startVitrine } from '../support/vitrine.ts';
import type { RunningVitrine } from '../support/vitrine.ts';

let harbor: FakeHarbor;
let naval: RunningVitrine;
let plain: RunningVitrine;

const navalLight = 'rgb(244, 247, 251)';
const navalDark = 'rgb(10, 21, 32)';

test.beforeAll(async () => {
	harbor = await startFakeHarbor({ projects: { platform: ['platform/api'] } });
	const settings = {
		sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'] }],
		routes: [
			{ url: '/', controller: 'harbor-images' },
			{ url: '/harbor/:source', controller: 'harbor' },
			{ url: '/harbor/:source/:project', controller: 'harbor-images' },
		],
		navigation: [{ label: 'Harbor projects', url: '/harbor/main-harbor' }],
	};
	naval = await startVitrine({ ...settings, theme: { name: 'naval', primary: 'rgb(200, 0, 0)', dark: { primary: 'rgb(0, 200, 0)' } } });
	plain = await startVitrine(settings);
});

test.afterAll(async () => {
	await naval?.stop();
	await plain?.stop();
	await harbor?.stop();
});

const background = (page: Page) => page.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor);
const modeMenu = (page: Page) => page.getByRole('combobox', { name: 'Colour mode' });

test('a Visitor sees the colour mode of their system, and its change without a reload', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto(naval.url);
	expect(await background(page)).toBe(navalDark);
	await expect(modeMenu(page)).toHaveValue('system');

	await page.emulateMedia({ colorScheme: 'light' });
	expect(await background(page)).toBe(navalLight);
});

test('a Visitor picks a colour mode at the top right, and Vitrine remembers it', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto(naval.url);

	const menu = modeMenu(page);
	const header = (await page.locator('.site-header').boundingBox())!;
	const box = (await menu.boundingBox())!;
	expect(header.x + header.width - (box.x + box.width)).toBeLessThan(64);

	await menu.selectOption('dark');
	expect(await background(page)).toBe(navalDark);

	await page.goto(`${naval.url}/harbor/main-harbor`);
	expect(await background(page)).toBe(navalDark);
	await expect(modeMenu(page)).toHaveValue('dark');

	// Back to System: the page follows the system again, even after it changes.
	await modeMenu(page).selectOption('system');
	expect(await background(page)).toBe(navalLight);
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.reload();
	expect(await background(page)).toBe(navalDark);
});

test('a Visitor who picked light keeps it on a dark system', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto(naval.url);
	await modeMenu(page).selectOption('light');

	await page.reload();
	expect(await background(page)).toBe(navalLight);
});

test('a Visitor sees the remembered mode from the first paint', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.addInitScript(() => localStorage.setItem('vitrine-color-mode', 'dark'));
	// Read the mode as soon as <body> starts, before any of it paints and before any bundled script has run.
	await page.addInitScript(() => {
		new MutationObserver((_, observer) => {
			if (!document.body) return;
			observer.disconnect();
			(window as unknown as { firstMode?: string }).firstMode = document.documentElement.dataset.colorMode;
		}).observe(document, { childList: true, subtree: true });
	});
	await page.goto(naval.url);

	expect(await page.evaluate(() => (window as unknown as { firstMode?: string }).firstMode)).toBe('dark');
	expect(await background(page)).toBe(navalDark);
});

test('a colour from Settings applies to its own mode', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto(naval.url);

	// The colour that Components read as the primary one, resolved in the current mode.
	const primary = () => page.evaluate(() => {
		const probe = document.createElement('span');
		probe.style.color = 'var(--color-primary)';
		document.body.append(probe);
		const colour = getComputedStyle(probe).color;
		probe.remove();
		return colour;
	});
	expect(await primary()).toBe('rgb(200, 0, 0)');
	await modeMenu(page).selectOption('dark');
	expect(await primary()).toBe('rgb(0, 200, 0)');
});

test('a Visitor without JavaScript still sees the colour mode of their system, and no menu', async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
	const page = await context.newPage();
	await page.goto(naval.url);

	expect(await background(page)).toBe(navalDark);
	await expect(page.locator('select.color-mode')).toBeHidden();
	await context.close();
});

test('Vitrine without a named Theme also has a light and a dark mode', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto(plain.url);
	const light = await background(page);

	await modeMenu(page).selectOption('dark');
	const dark = await background(page);
	expect(dark).not.toBe(light);
	expect(await page.locator('body').evaluate((body) => getComputedStyle(body).colorScheme)).toBe('dark');
});
