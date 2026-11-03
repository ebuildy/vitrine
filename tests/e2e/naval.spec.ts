import { expect, test } from '@playwright/test';
import { startFakeGitlab } from '../support/fake-gitlab.ts';
import type { FakeGitlab } from '../support/fake-gitlab.ts';
import { startFakeHarbor } from '../support/fake-harbor.ts';
import type { FakeHarbor } from '../support/fake-harbor.ts';
import { startVitrine } from '../support/vitrine.ts';
import type { RunningVitrine } from '../support/vitrine.ts';

let harbor: FakeHarbor;
let gitlab: FakeGitlab;
let naval: RunningVitrine;
let overridden: RunningVitrine;

test.beforeAll(async () => {
	harbor = await startFakeHarbor({ projects: { platform: ['platform/api'] } });
	gitlab = await startFakeGitlab({
		groups: [{ path: 'platform', name: 'The Platform' }],
		projects: [{ path: 'platform/api', readme: '# API\n\n```sh\nmake run\n```\n\n```json\n{}\n```', releases: [], contributors: [], commits: [], issues: [] }],
	});
	const settings = {
		sources: [
			{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'] },
			{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform'] },
		],
		routes: [
			{ url: '/gitlab/:group+', controller: 'gitlab-group' },
			{ url: '/gitlab/:group+/-/:project', controller: 'gitlab-project' },
			{ url: '/harbor/:source', controller: 'harbor' },
			{ url: '/harbor/:source/:project', controller: 'harbor-images' },
		],
		navigation: [{ label: 'Harbor projects', url: '/harbor/main-harbor' }],
	};
	naval = await startVitrine({ ...settings, theme: { name: 'naval' } });
	overridden = await startVitrine({ ...settings, theme: { name: 'naval', primary: 'rgb(200, 0, 0)' } });
});

test.afterAll(async () => {
	await naval?.stop();
	await overridden?.stop();
	await harbor?.stop();
	await gitlab?.stop();
});

test('a Visitor sees the naval Theme in blues', async ({ page }) => {
	await page.goto(`${naval.url}/harbor/main-harbor`);

	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 247, 251)');
	await expect(page.locator('body')).toHaveCSS('color', 'rgb(15, 33, 55)');
	await expect(page.getByRole('listitem').filter({ hasText: 'platform' })).toHaveCSS('border-top-color', 'rgb(221, 230, 239)');
});

test('a Visitor sees the page in a centred column, under a white site header', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 800 });
	await page.goto(`${naval.url}/harbor/main-harbor`);

	const siteHeader = page.locator('header', { hasText: 'Vitrine' });
	await expect(siteHeader).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.88)');
	expect((await siteHeader.boundingBox())!.width).toBe(1600);

	const projects = (await page.getByRole('list').filter({ has: page.getByRole('listitem').filter({ hasText: 'platform' }) }).boundingBox())!;
	expect(projects.width).toBeLessThanOrEqual(78 * 16);
	expect(Math.abs(projects.x - (1600 - projects.x - projects.width))).toBeLessThan(2);
});

test('a Visitor sees which Menu item is the current page', async ({ page }) => {
	await page.goto(`${naval.url}/harbor/main-harbor`);

	const current = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Harbor projects' });
	await expect(current).toHaveAttribute('aria-current', 'page');
	await expect(current).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('a Visitor sees naval cards on white, lifting under the pointer', async ({ page }) => {
	await page.goto(`${naval.url}/harbor/main-harbor`);

	const card = page.getByRole('listitem').filter({ hasText: 'platform' });
	await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
	await expect(card).toHaveCSS('border-top-left-radius', '10px');
	expect(await card.evaluate((element) => getComputedStyle(element).boxShadow)).toMatch(/rgba\(11, 37, 69, [\d.]+\) 0px \d+px/);
	await expect(card).toHaveCSS('transform', 'none');

	await card.hover();
	await expect(card).not.toHaveCSS('transform', 'none');
});

test('a Visitor who prefers less motion sees naval cards stay in place', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto(`${naval.url}/harbor/main-harbor`);

	const card = page.getByRole('listitem').filter({ hasText: 'platform' });
	await card.hover();
	await expect(card).toHaveCSS('transform', 'none');
});

test('a Visitor sees the white band on the site header only, not on the header of a page', async ({ page }) => {
	await page.goto(`${naval.url}/gitlab/platform`);

	await expect(page.locator('header', { hasText: 'Vitrine' })).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.88)');
	await expect(page.locator('header', { hasText: 'The Platform' })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('a Visitor sees waves at the bottom of a naval page, below its content', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`${naval.url}/harbor/main-harbor`);

	const wave = await page.evaluate(() => {
		const style = getComputedStyle(document.body, '::after');
		return { image: style.backgroundImage, height: style.height, bodyBottom: document.body.getBoundingClientRect().bottom };
	});
	expect(wave.image).toContain('svg');
	expect(parseFloat(wave.height)).toBeGreaterThan(0);
	// A short page still ends at the bottom of the window.
	expect(wave.bodyBottom).toBeGreaterThanOrEqual(800);

	const lastCard = await page.getByRole('listitem').last().boundingBox();
	expect(lastCard!.y + lastCard!.height).toBeLessThanOrEqual(wave.bodyBottom - parseFloat(wave.height));
});

test('a colour from Settings wins over the naval Theme', async ({ page }) => {
	await page.goto(`${overridden.url}/harbor/main-harbor`);

	const card = page.getByRole('listitem').filter({ hasText: 'platform' });
	await card.hover();
	await expect(card.getByRole('heading').getByRole('link')).toHaveCSS('color', 'rgb(200, 0, 0)');
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 247, 251)');
});

test('a Visitor sees the naval waves drift', async ({ page }) => {
	await page.goto(`${naval.url}/harbor/main-harbor`);

	const before = await page.evaluate(() => getComputedStyle(document.body, '::after').backgroundPositionX);
	await page.waitForTimeout(500);
	const after = await page.evaluate(() => getComputedStyle(document.body, '::after').backgroundPositionX);
	expect(after).not.toBe(before);
});

test('a Visitor sees boats and submarines cross the naval sea, never more than two at once', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`${naval.url}/harbor/main-harbor`);

	const sea = page.locator('.sea');
	await expect(sea).toHaveAttribute('aria-hidden', 'true');
	await expect(sea.locator('.boat')).not.toHaveCount(0);
	await expect(sea.locator('.submarine')).not.toHaveCount(0);

	// Step through a whole cycle of the voyages, and count the vessels inside the sea at each second.
	const counts = await page.evaluate(() => {
		const voyages = document.getAnimations().filter((animation) => {
			const target = (animation.effect as KeyframeEffect | null)?.target;
			return target instanceof Element && target.matches('.sea .vessel');
		});
		voyages.forEach((animation) => animation.pause());
		const longest = Math.max(...voyages.map((animation) => Number(animation.effect!.getTiming().duration)));
		const sea = document.querySelector('.sea')!.getBoundingClientRect();
		const counts = [];
		for (let time = 0; time <= 2 * longest; time += 1000) {
			voyages.forEach((animation) => (animation.currentTime = time));
			const inside = [...document.querySelectorAll('.sea .vessel')].filter((vessel) => {
				const box = vessel.getBoundingClientRect();
				return box.right > sea.left && box.left < sea.right;
			});
			counts.push(inside.length);
		}
		return counts;
	});
	expect(Math.max(...counts)).toBe(2);
	expect(counts.filter((count) => count > 0).length).toBeGreaterThan(counts.length / 2);
});

test('a Visitor who prefers less motion sees a still naval sea, with no vessels', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto(`${naval.url}/harbor/main-harbor`);

	expect(await page.evaluate(() => getComputedStyle(document.body, '::after').animationName)).toBe('none');
	await expect(page.locator('.sea .vessel').first()).toBeHidden();
});

test('a Visitor sees each part of a Project in a card, under a title with an emoji that screen readers skip', async ({ page }) => {
	await page.goto(`${naval.url}/gitlab/platform/-/api`);

	for (const [title, emoji] of [
		['README', '📖'],
		['Latest commits', '📝'],
		['Latest Issues', '🐛'],
		['Releases', '🚀'],
		['Contributors', '👥'],
	]) {
		const heading = page.getByRole('heading', { name: title, exact: true });
		await expect(heading).toBeVisible();
		expect(await heading.evaluate((element) => getComputedStyle(element, '::before').content)).toContain(emoji);
		// The title sits above its card, on the page itself.
		await expect(heading).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
		const card = page.locator('section', { has: heading }).locator('> .card');
		await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
		expect((await heading.boundingBox())!.y).toBeLessThan((await card.boundingBox())!.y);
	}
});

test('a Visitor sees the code of a README in a dark window, and a shell block labelled as a terminal', async ({ page }) => {
	await page.goto(`${naval.url}/gitlab/platform/-/api`);

	const shell = page.locator('.readme pre', { hasText: 'make run' });
	await expect(shell).toHaveCSS('background-color', 'rgb(11, 26, 46)');
	expect(await shell.evaluate((element) => getComputedStyle(element, '::after').content)).toContain('Terminal');

	const json = page.locator('.readme pre', { hasText: '{}' });
	await expect(json).toHaveCSS('background-color', 'rgb(11, 26, 46)');
	expect(await json.evaluate((element) => getComputedStyle(element, '::after').content)).not.toContain('Terminal');
});
