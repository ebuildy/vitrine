import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startFakeGitlab } from '../support/fake-gitlab.ts';
import type { FakeGitlab } from '../support/fake-gitlab.ts';
import { startFakeHarbor } from '../support/fake-harbor.ts';
import type { FakeHarbor } from '../support/fake-harbor.ts';
import { startVitrine } from '../support/vitrine.ts';
import type { RunningVitrine } from '../support/vitrine.ts';

let gitlab: FakeGitlab;
let harbor: FakeHarbor;
let vitrine: RunningVitrine;

test.beforeAll(async () => {
	gitlab = await startFakeGitlab({
		groups: [{ path: 'platform', members: [{ id: 1, name: 'Ada Lovelace' }] }, { path: 'platform/backend' }],
		projects: [{ path: 'platform/api', releases: [{ name: 'Spring', tag_name: 'v1', released_at: '2026-03-20T08:00:00.000Z' }] }],
	});
	harbor = await startFakeHarbor({ projects: { library: [] } });
	vitrine = await startVitrine({
		sources: [
			{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform'] },
			{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['library'] },
		],
		routes: [
			{ url: '/', controller: 'navigation' },
			{ url: '/columns', controller: 'navigation', params: { arrangement: 'columns' } },
			{ url: '/list', controller: 'navigation', params: { arrangement: 'list' } },
			{ url: '/harbor/:source', controller: 'harbor' },
			{ url: '/harbor/:source/:project', controller: 'harbor-images' },
			{ url: '/gitlab/:group+', controller: 'gitlab-group' },
			{ url: '/gitlab/:group+/-/:project', controller: 'gitlab-project' },
		],
	});
});

test.afterAll(async () => {
	await vitrine?.stop();
	await gitlab?.stop();
	await harbor?.stop();
});

async function topOf(page: Page, name: string) {
	const box = await page.getByRole('heading', { name, exact: true }).boundingBox();
	if (!box) throw new Error(`No heading ${name}`);
	return box.y;
}

async function arrangementOn(page: Page) {
	const [releases, harborProjects, overview, members] = await Promise.all(['Releases of platform', 'Harbor projects of main-harbor', 'Overview', 'Members'].map((name) => topOf(page, name)));
	return { overviewSideBySide: releases === harborProjects, sectionsSideBySide: overview === members };
}

test('the grid sets the Overview side by side, above the other sections', async ({ page }) => {
	await page.goto(`${vitrine.url}/`);

	expect(await arrangementOn(page)).toEqual({ overviewSideBySide: true, sectionsSideBySide: false });
});

test('the columns give each section a column', async ({ page }) => {
	await page.goto(`${vitrine.url}/columns`);

	expect(await arrangementOn(page)).toEqual({ overviewSideBySide: false, sectionsSideBySide: true });
});

test('the list runs everything down the page', async ({ page }) => {
	await page.goto(`${vitrine.url}/list`);

	expect(await arrangementOn(page)).toEqual({ overviewSideBySide: false, sectionsSideBySide: false });
});

test('a Visitor goes from a release to its Project', async ({ page }) => {
	await page.goto(`${vitrine.url}/`);

	await page.getByRole('link', { name: 'api', exact: true }).click();

	await expect(page).toHaveURL(/\/gitlab\/platform\/-\/api$/);
});

test('a Visitor reads a Navigation page on a phone without scrolling sideways', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 800 });
	await page.goto(`${vitrine.url}/`);

	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
