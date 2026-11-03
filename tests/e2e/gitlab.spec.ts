import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startFakeGitlab } from '../support/fake-gitlab.ts';
import type { FakeGitlab } from '../support/fake-gitlab.ts';
import { startVitrine } from '../support/vitrine.ts';
import type { RunningVitrine } from '../support/vitrine.ts';

let gitlab: FakeGitlab;
let vitrine: RunningVitrine;

// Five subgroups of three Projects each.
const subgroups = ['backend', 'frontend', 'data', 'infra', 'tools'];

test.beforeAll(async () => {
	gitlab = await startFakeGitlab({
		groups: [
			{
				path: 'platform',
				name: 'The Platform',
				epics: [
					{
						title: 'Later work',
						startDate: '2026-03-01',
						dueDate: '2026-03-31',
						description: 'The **second** phase',
						assignees: [{ name: 'Ada Lovelace', avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }],
						weight: 5,
						issues: { all: 4, closed: 1 },
					},
					{ title: 'Early work', startDate: '2026-01-01', dueDate: '2026-01-31' },
					{ title: 'Undated work' },
					{ title: 'Leaked plans', confidential: true },
				],
			},
			...subgroups.map((name) => ({ path: `platform/${name}` })),
		],
		projects: subgroups.flatMap((subgroup) =>
			['api', 'worker', 'docs'].map((name) => ({
				path: `platform/${subgroup}/${name}`,
				description: `The ${name} of ${subgroup}`,
				readme: `# About ${name}\n\nRead the [guide](docs/guide.md).`,
				commits: [{ title: 'Add login', author_name: 'Ada', committed_date: '2026-09-15T08:00:00.000Z', web_url: 'http://gitlab.test/c' }],
				releases: [{ name: 'Spring', tag_name: 'v1', released_at: '2026-03-20T08:00:00.000Z' }],
				contributors: [{ name: 'Ada Lovelace', email: 'ada@example.com', commits: 3 }],
			})),
		),
	});
	vitrine = await startVitrine({
		sources: [{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform'] }],
		routes: [
			{ url: '/gitlab/:group+', controller: 'gitlab-group' },
			{ url: '/gitlab/:group+/-/:project', controller: 'gitlab-project' },
			{ url: '/roadmap/:group+', controller: 'gitlab-roadmap' },
		],
	});
});

test.afterAll(async () => {
	await vitrine?.stop();
	await gitlab?.stop();
});

function sectionOf(page: Page, heading: string) {
	return page.locator('section').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
}

test('a Visitor browses from a Main Group through a subgroup to a Project', async ({ page }) => {
	await page.goto(`${vitrine.url}/gitlab/platform`);

	await expect(page.getByRole('heading', { name: 'The Platform' })).toBeVisible();
	await expect(page.getByRole('heading', { level: 3 }).getByRole('link', { name: 'backend' })).toBeVisible();
	await expect(sectionOf(page, 'Subgroups').getByRole('listitem')).toHaveCount(5);
	await expect(sectionOf(page, 'Projects').getByRole('listitem')).toHaveCount(15);

	await page.getByRole('link', { name: 'backend' }).click();

	await expect(page).toHaveURL(`${vitrine.url}/gitlab/platform/backend`);
	await expect(sectionOf(page, 'Projects').getByRole('listitem')).toHaveCount(3);

	await page.getByRole('link', { name: 'api' }).click();

	await expect(page).toHaveURL(`${vitrine.url}/gitlab/platform/backend/-/api`);
	await expect(page.getByRole('heading', { name: 'About api' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Add login' })).toBeVisible();
	await expect(page.getByRole('complementary').getByText('Spring')).toBeVisible();
	await expect(page.getByRole('complementary').getByText('Ada Lovelace')).toBeVisible();
});

test('a Visitor opens a Project by clicking anywhere on its card', async ({ page }) => {
	await page.goto(`${vitrine.url}/gitlab/platform/backend`);

	await page.getByRole('listitem').filter({ hasText: 'The worker of backend' }).click();

	await expect(page).toHaveURL(`${vitrine.url}/gitlab/platform/backend/-/worker`);
});

test('a Visitor leaves a card for GitLab through its own link', async ({ page }) => {
	await page.goto(`${vitrine.url}/gitlab/platform/backend`);

	const link = page.getByRole('listitem').filter({ hasText: 'The worker of backend' }).getByRole('link', { name: 'View in GitLab' });
	await link.click();

	await expect(page).toHaveURL(`${gitlab.url}/platform/backend/worker`);
});

test('a Visitor sees the sidebar beside the main content', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`${vitrine.url}/gitlab/platform/backend/-/api`);

	const main = await page.getByRole('main').boundingBox();
	const aside = await page.getByRole('complementary').boundingBox();

	expect(aside?.x).toBeGreaterThan((main?.x ?? 0) + (main?.width ?? 0) - 1);
});

test('a Visitor reads the Roadmap of a Main Group and opens an Epic in GitLab', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`${vitrine.url}/roadmap/platform`);

	const roadmap = sectionOf(page, 'Roadmap');
	const rows = roadmap.locator('.gantt li');
	await expect(rows.getByRole('link')).toHaveText(['Early work', 'Later work']);
	await expect(roadmap.getByText('Leaked plans')).toHaveCount(0);

	// January to March 2026 holds 90 days: Early work takes the first 31, and Later work the last 31 of them.
	const track = await rows.nth(0).locator('.track').boundingBox();
	const early = await rows.nth(0).locator('.bar').boundingBox();
	const later = await rows.nth(1).locator('.bar').boundingBox();
	const days = (track?.width ?? 0) / 90;
	expect(early?.x).toBeCloseTo(track?.x ?? 0, 0);
	expect(early?.width).toBeCloseTo(31 * days, 0);
	expect(later?.x).toBeCloseTo((track?.x ?? 0) + 59 * days, 0);
	expect(later?.width).toBeCloseTo(31 * days, 0);
	await expect(roadmap.getByText('2026-02', { exact: true })).toBeVisible();

	await expect(roadmap.locator('h3 + ul').getByRole('link')).toHaveText(['Undated work']);

	await rows.getByRole('link', { name: 'Later work' }).click();

	await expect(page).toHaveURL(`${gitlab.url}/groups/platform/-/work_items/1`);
});

test('a Visitor reads the details of each Epic beneath the Roadmap', async ({ page }) => {
	await page.goto(`${vitrine.url}/roadmap/platform`);

	const epic = sectionOf(page, 'Epics').getByRole('listitem').filter({ hasText: 'Later work' });
	await expect(epic.getByText('phase')).toBeVisible();
	await expect(epic.getByAltText('Ada Lovelace')).toBeVisible();
	await expect(epic.getByRole('progressbar')).toHaveAttribute('value', '1');
	await expect(epic.getByText('25%')).toBeVisible();
	await expect(epic.getByText('4 Issues')).toBeVisible();
	await expect(epic.getByText('Weight 5')).toBeVisible();
});

test('a Visitor reads the Roadmap on a phone without scrolling sideways', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 700 });
	await page.goto(`${vitrine.url}/roadmap/platform`);

	await expect(sectionOf(page, 'Roadmap').locator('.bar').first()).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('a Visitor folds and unfolds a part of a Project by clicking its title', async ({ page }) => {
	await page.goto(`${vitrine.url}/gitlab/platform/backend/-/api`);

	const toggle = page.getByRole('heading', { name: 'README' }).getByRole('button', { name: 'README' });
	const guide = page.getByRole('link', { name: 'guide' });
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await expect(guide).toBeVisible();

	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect(guide).toBeHidden();

	// The whole title strip is the target, chevron included, not only the words.
	const title = (await page.getByRole('heading', { name: 'README' }).boundingBox())!;
	await page.mouse.click(title.x + title.width - 4, title.y + title.height / 2);
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await expect(guide).toBeVisible();
});

test('a Visitor folds a part of a Project from the keyboard', async ({ page }) => {
	await page.goto(`${vitrine.url}/gitlab/platform/backend/-/api`);

	const toggle = page.getByRole('button', { name: 'Latest commits' });
	await toggle.focus();
	await page.keyboard.press('Enter');
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect(page.getByRole('link', { name: 'Add login' })).toBeHidden();
	await page.keyboard.press('Space');
	await expect(page.getByRole('link', { name: 'Add login' })).toBeVisible();
});

test('a Visitor sees the main parts of a Project fold, and the sidebar stay open', async ({ page }) => {
	await page.goto(`${vitrine.url}/gitlab/platform/backend/-/api`);

	for (const name of ['README', 'Latest commits', 'Latest Issues']) await expect(page.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true');
	for (const name of ['Releases', 'Contributors']) await expect(page.getByRole('heading', { name }).getByRole('button')).toHaveCount(0);
});
