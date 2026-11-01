import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startFakeGitlab } from './support/fake-gitlab.ts';
import type { FakeGitlab } from './support/fake-gitlab.ts';
import { startFakeHarbor } from './support/fake-harbor.ts';
import { startDevVitrine, startupFailure, startVitrine, writeEnvFile } from './support/vitrine.ts';
import type { RunningVitrine } from './support/vitrine.ts';

const groups = [{ path: 'platform', name: 'The Platform', description: 'Everything we run' }, { path: 'platform/backend' }];
const projects = [{ path: 'platform/backend/api', description: 'The public API', topics: [] }];

const rearranged = `---
const labels = ['first', 'second'];
---
<h2>Rearranged page</h2>
<ul>{labels.map((label) => <li>{label} of {group}</li>)}</ul>
<GitlabProjectList source={source} group={group} />`;

describe.each([
	['the built server', startVitrine],
	['astro dev', startDevVitrine],
])('a Template under %s', (_, start) => {
	let gitlab: FakeGitlab;
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		gitlab = await startFakeGitlab({ groups, projects });
		vitrine = await start({
			sources: [{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform'] }],
			routes: [
				{ url: '/gitlab/:group+', controller: 'gitlab-group', template: rearranged },
				{ url: '/plain/:group+', controller: 'gitlab-group' },
				{ url: '/gitlab/:group+/-/:project', controller: 'gitlab-project' },
			],
		});
	}, 60_000);

	afterAll(async () => {
		await vitrine?.stop();
		await gitlab?.stop();
	});

	test('replaces what the Controller arranges and keeps the title', async () => {
		const response = await fetch(`${vitrine.url}/gitlab/platform`);

		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('<title>The Platform</title>');
		expect(html).toContain('<meta name="description" content="Everything we run"');
		expect(html).toContain('<h2>Rearranged page</h2>');
		expect(html).not.toContain('>Members<');
	});

	test('keeps the head of the page before its body', async () => {
		const html = await (await fetch(`${vitrine.url}/gitlab/platform`)).text();

		const [head, body] = html.split('<body');
		expect(head).toMatch(/<link rel="stylesheet"|<style/);
		expect(body).not.toMatch(/<link rel="stylesheet"/);
	});

	test('answers not found for a Group outside every Main Group', async () => {
		const response = await fetch(`${vitrine.url}/gitlab/hidden`);

		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain('Rearranged page');
	});

	test('answers not found for an unknown Group', async () => {
		const response = await fetch(`${vitrine.url}/gitlab/platform/nope`);

		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain('Rearranged page');
	});

	test('runs frontmatter and loops, with Route values as plain variables', async () => {
		const html = await (await fetch(`${vitrine.url}/gitlab/platform`)).text();

		expect(html).toContain('<li>first of platform</li>');
		expect(html).toContain('<li>second of platform</li>');
	});

	test('places a Component with no import', async () => {
		const html = await (await fetch(`${vitrine.url}/gitlab/platform`)).text();

		expect(html).toContain('href="/gitlab/platform/backend/-/api"');
	});

	test('leaves a Route without a Template as it is', async () => {
		const html = await (await fetch(`${vitrine.url}/plain/platform`)).text();

		expect(html).not.toContain('Rearranged page');
		expect(html).toContain('>Members<');
	});
});

describe('Templates on every Controller', () => {
	const sharedTemplate = `<h2>Shared by anchor</h2>`;
	const shows = (name: string) => `<h2>Template of ${name}</h2><p class="scope">{title}|{description}|{source}|{group}|{project}|{path}</p>`;
	const secrets = { GITLAB_TOKEN: 'gitlab-s3cret', HARBOR_PASSWORD: 'harbor-s3cret' };
	let gitlab: FakeGitlab;
	let harbor: Awaited<ReturnType<typeof startFakeHarbor>>;
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		gitlab = await startFakeGitlab({ groups, projects, token: secrets.GITLAB_TOKEN });
		harbor = await startFakeHarbor({ projects: { platform: ['platform/api'] }, credentials: { username: 'robot', password: secrets.HARBOR_PASSWORD } });
		// Written as text, as an anchor is the feature under test.
		vitrine = await startVitrine(
			`
sources:
  - { name: main-harbor, type: harbor, url: ${harbor.url}, projects: [platform], username: robot, passwordEnv: HARBOR_PASSWORD }
  - { name: main-gitlab, type: gitlab, url: ${gitlab.url}, mainGroups: [platform], tokenEnv: GITLAB_TOKEN }
routes:
  - { url: '/harbor/:source', controller: harbor, template: ${JSON.stringify(shows('harbor'))} }
  - { url: '/harbor/:source/:project', controller: harbor-images, template: ${JSON.stringify(shows('harbor-images'))} }
  - { url: '/images', controller: harbor-images, template: ${JSON.stringify(shows('images'))} }
  - { url: '/gitlab/:group+', controller: gitlab-group, template: ${JSON.stringify(shows('gitlab-group'))} }
  - { url: '/gitlab/:group+/-/:project', controller: gitlab-project, template: ${JSON.stringify(shows('gitlab-project'))} }
  - { url: '/roadmap/:group+', controller: gitlab-roadmap, template: ${JSON.stringify(shows('gitlab-roadmap'))} }
  - { url: '/issues/:group+', controller: gitlab-issues, template: ${JSON.stringify(shows('gitlab-issues'))} }
  - { url: '/one', controller: harbor-images, template: &shared ${JSON.stringify(sharedTemplate)} }
  - { url: '/two', controller: harbor-images, template: *shared }
  - { url: '/location', controller: harbor-images, template: '<p>{Astro.url.pathname}</p>' }
  - { url: '/sources', controller: harbor-images, template: '<pre>{JSON.stringify(sources)}</pre>' }
`,
			secrets,
		);
	});

	afterAll(async () => {
		await vitrine?.stop();
		await gitlab?.stop();
		await harbor?.stop();
	});

	const page = async (url: string) => (await fetch(`${vitrine.url}${url}`)).text();

	test.each([
		['harbor', '/harbor/main-harbor', 'main-harbor', 'main-harbor||main-harbor|||'],
		['harbor-images', '/harbor/main-harbor/platform', 'Images', 'Images||main-harbor||platform|'],
		['images', '/images', 'Images', 'Images|||||'],
		['gitlab-group', '/gitlab/platform', 'The Platform', 'The Platform|Everything we run|main-gitlab|platform||'],
		['gitlab-project', '/gitlab/platform/backend/-/api', 'api', 'api|The public API|main-gitlab|platform/backend|api|platform/backend/api'],
		['gitlab-roadmap', '/roadmap/platform', 'The Platform Roadmap', 'The Platform Roadmap|Everything we run|main-gitlab|platform||'],
		['gitlab-issues', '/issues/platform', 'The Platform Issues', 'The Platform Issues|Everything we run|main-gitlab|platform||'],
	])('renders on a %s Route with the values of its page', async (name, url, title, scope) => {
		const html = await page(url);

		expect(html).toContain(`<title>${title}</title>`);
		expect(html).toContain(`<h2>Template of ${name}</h2>`);
		expect(html).toContain(`<p class="scope">${scope}</p>`);
	});

	test('gives two Routes on one Controller different Templates', async () => {
		expect(await page('/images')).toContain('Template of images');
		expect(await page('/harbor/main-harbor/platform')).toContain('Template of harbor-images');
	});

	test('shares one Template between Routes through a YAML anchor', async () => {
		expect(await page('/one')).toContain('Shared by anchor');
		expect(await page('/two')).toContain('Shared by anchor');
	});

	test('offers the Astro global', async () => {
		expect(await page('/location')).toContain('<p>/location</p>');
	});

	test('lists Sources with what they aggregate and no secret', async () => {
		const html = (await page('/sources')).replaceAll('&quot;', '"');

		expect(html).toContain(`"name":"main-harbor","type":"harbor","url":"${harbor.url}","projects":["platform"]`);
		expect(html).toContain(`"name":"main-gitlab","type":"gitlab","url":"${gitlab.url}","mainGroups":["platform"]`);
		expect(html).not.toContain(secrets.GITLAB_TOKEN);
		expect(html).not.toContain(secrets.HARBOR_PASSWORD);
		expect(html).not.toContain('robot');
		expect(html).not.toContain('Env');
	});
});

describe.each([
	['the built server', startVitrine],
	['astro dev', startDevVitrine],
])('the style and script of a Template under %s', (_, start) => {
	let harbor: Awaited<ReturnType<typeof startFakeHarbor>>;
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		harbor = await startFakeHarbor({ projects: { platform: ['platform/api'] } });
		vitrine = await start({
			sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'] }],
			routes: [
				{
					url: '/images',
					controller: 'harbor-images',
					template: `<h2 class="mine">Styled</h2><ImageList source="main-harbor" project="platform" /><style>.mine { color: red; } h2 { margin: 0; }</style><script>document.title = 'from a Template';</script>`,
				},
			],
		});
	}, 60_000);

	afterAll(async () => {
		await vitrine?.stop();
		await harbor?.stop();
	});

	test('scopes the style to the elements of the Template', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		const scope = /<h2 class="mine (astro-\w+)">Styled<\/h2>/.exec(html)?.[1];
		expect(scope).toBeDefined();
		expect(html).toContain(`.mine:where(.${scope})`);
		expect(html).toContain(`h2:where(.${scope})`);
		expect(html).toMatch(/<h2[^>]*>platform\/api<\/h2>/);
		expect(html).not.toMatch(new RegExp(`<h2[^>]*${scope}[^>]*>platform/api`));
	});

	test('puts the script in the page', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		expect(html).toMatch(/<script type="module">\s*document\.title = "from a Template";\s*<\/script>/);
	});
});

describe('a Template that fails on a page', () => {
	const failing = '---\nthrow new Error("boom from the frontmatter");\n---\n<h2>Never shown</h2>';
	const failingLate = '<h2>Before the failure</h2>{(() => { throw new Error("boom from the markup"); })()}';
	const undefinedName = '<p>{noSuchName}</p>';
	let harbor: Awaited<ReturnType<typeof startFakeHarbor>>;
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		harbor = await startFakeHarbor({ projects: { platform: ['platform/api'] } });
		vitrine = await startVitrine({
			sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'] }],
			routes: [
				{ url: '/frontmatter', controller: 'harbor-images', template: failing },
				{ url: '/markup', controller: 'harbor-images', template: failingLate },
				{ url: '/undefined', controller: 'harbor-images', template: undefinedName },
				{ url: '/working', controller: 'harbor-images', template: '<h2>Still working</h2>' },
			],
		});
	});

	afterAll(async () => {
		await vitrine?.stop();
		await harbor?.stop();
	});

	test.each([
		['/frontmatter', 'boom from the frontmatter', 'Never shown'],
		['/markup', 'boom from the markup', 'Before the failure'],
		['/undefined', 'noSuchName', 'noSuchName'],
	])('shows an alert inside the Layout and logs the real error on %s', async (url, error, hidden) => {
		const response = await fetch(`${vitrine.url}${url}`);

		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('<title>Images</title>');
		expect(html).toMatch(/<body[^>]*><p role="alert">This page could not be shown\.<\/p><\/body>/);
		expect(html).not.toContain(error);
		expect(html).not.toContain(hidden);
		expect(vitrine.stderr()).toContain(error);
	});

	test('leaves other pages alone', async () => {
		expect(await (await fetch(`${vitrine.url}/working`)).text()).toContain('Still working');
	});
});

describe.each([
	['the built server', startVitrine],
	['astro dev', startDevVitrine],
])('a page with a Template under %s', (_, start) => {
	const DELAY = 500;

	test('is not sent before the Template has rendered', async () => {
		const harbor = await startFakeHarbor({ projects: { platform: ['platform/api'] } });
		const vitrine = await start({
			sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'] }],
			routes: [{ url: '/images', controller: 'harbor-images', template: `---\nawait new Promise((resolve) => setTimeout(resolve, ${DELAY}));\n---\n<h2>Slow</h2>` }],
		});
		// The Templates compile again on the first request, which this test must not count.
		await (await fetch(`${vitrine.url}/images`)).text();

		const startedAt = Date.now();
		const response = await fetch(`${vitrine.url}/images`);
		const headersAfter = Date.now() - startedAt;
		const html = await response.text();

		await vitrine.stop();
		await harbor.stop();
		expect(headersAfter).toBeGreaterThanOrEqual(DELAY - 20);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
		expect(html).toContain('<title>Images</title>');
		expect(html).toContain('<h2>Slow</h2>');
	}, 60_000);
});

describe('a Template stops startup', () => {
	const harbor = { name: 'main-harbor', type: 'harbor', url: 'http://harbor.test', projects: ['platform'] };
	const gitlab = { name: 'main-gitlab', type: 'gitlab', url: 'http://gitlab.test', mainGroups: ['platform', 'data/analytics'] };
	const onGroup = (template: string) => ({
		sources: [harbor, gitlab],
		routes: [
			{ url: '/gitlab/:group+', controller: 'gitlab-group', template },
			{ url: '/gitlab/:group+/-/:project', controller: 'gitlab-project' },
		],
	});
	const onFixedSource = (template: string) => ({
		sources: [harbor, gitlab],
		routes: [{ url: '/images', controller: 'harbor-images', params: { source: 'main-harbor' }, template }],
	});

	test.each([
		['that does not compile', onGroup('<div>{'), 'does not compile'],
		['with broken frontmatter', onGroup('---\nconst = 1;\n---\n<p />'), 'does not compile'],
		['with an import', onGroup(`---\nimport helper from './helper.ts';\n---\n<p>{helper}</p>`), 'does not compile'],
		['with an unknown Component', onGroup('<GitlabNope />'), '<GitlabNope>'],
		['with an unknown Component in a loop', onGroup(`{['a'].map(() => <div><GitlabNope /></div>)}`), '<GitlabNope>'],
		['with an unknown Component behind a dot', onGroup('<Nope.Thing />'), '<Nope.Thing>'],
		['with a missing prop', onGroup('<GitlabGroupList source={source} />'), '<GitlabGroupList> needs the prop "group"'],
		['with a missing prop in a loop', onGroup(`{['a'].map(() => <GitlabGroupList source={source} />)}`), '<GitlabGroupList> needs the prop "group"'],
		['with an unknown prop', onGroup('<GitlabGroupList source={source} group={group} sauce="x" />'), '<GitlabGroupList> has no prop "sauce"'],
		['with an island', onGroup('<GitlabGroupList source={source} group={group} client:load />'), '<GitlabGroupList> has no prop "client:load"'],
		['with a Component of the wrong Source type for the Route', onGroup('<HarborProjectList source={source} />'), '<HarborProjectList> needs a harbor Source'],
		['with a Component of the wrong Source type for a fixed Route Source', onFixedSource('<GitlabGroupList source={source} group="platform" />'), '<GitlabGroupList> needs a gitlab Source'],
		['with a fixed Source of the wrong type', onGroup('<ImageList source="main-gitlab" project="platform" />'), '<ImageList> needs a harbor Source'],
		['with a fixed Source that does not exist', onGroup('<GitlabGroupList source="nope" group="platform" />'), 'unknown Source "nope"'],
		['with a fixed Group outside every Main Group', onGroup('<GitlabGroupList source={source} group="hidden" />'), '"hidden" is outside every Main Group'],
		['with a fixed Project outside every Main Group', onGroup('<GitlabReadme source="main-gitlab" project="data/other/x" />'), '"data/other/x" is outside every Main Group'],
		['with a fixed Group in an expression', onGroup(`<GitlabGroupList source={source} group={'hidden'} />`), '"hidden" is outside every Main Group'],
		['with a fixed Group as a plain template string', onGroup('<GitlabGroupList source={source} group={`hidden`} />'), '"hidden" is outside every Main Group'],
	])('%s', async (_, settings, expectedError) => {
		const { exitCode, output } = await startupFailure(settings);

		expect(exitCode).toBe(1);
		expect(output).toContain('Route "');
		expect(output).toContain(expectedError);
	});

	test('and names the Route at fault', async () => {
		const { output } = await startupFailure(onGroup('<GitlabNope />'));

		expect(output).toContain('Route "/gitlab/:group+"');
	});
});

test('a Route value that comes from the URL is not read from the params it overrides', async () => {
	const fake = await startFakeGitlab({ groups, projects });
	const vitrine = await startVitrine({
		sources: [{ name: 'main-gitlab', type: 'gitlab', url: fake.url, mainGroups: ['platform'] }],
		routes: [
			{ url: '/gitlab/:group+', controller: 'gitlab-group', params: { group: 'hidden' }, template: '<GitlabGroupList source={source} group={group} />' },
			{ url: '/gitlab/:group+/-/:project', controller: 'gitlab-project' },
		],
	});

	const response = await fetch(`${vitrine.url}/gitlab/platform`);

	await vitrine.stop();
	await fake.stop();
	expect(response.status).toBe(200);
});

test('the demo Settings file starts Vitrine with its Template', async () => {
	const vitrine = await startVitrine(readFileSync('demo/settings.yaml', 'utf8'), { HARBOR_PASSWORD: 's3cret', GITLAB_TOKEN: 's3cret' });

	const html = await (await fetch(`${vitrine.url}/welcome`)).text();

	await vitrine.stop();
	expect(html).toContain('Welcome to the demo');
	expect(html).toContain('main-harbor');
});

describe('a Template starts', () => {
	const gitlab = (url: string) => ({ name: 'main-gitlab', type: 'gitlab', url, mainGroups: ['platform'] });
	const routes = (template: string) => [
		{ url: '/gitlab/:group+', controller: 'gitlab-group', template },
		{ url: '/gitlab/:group+/-/:project', controller: 'gitlab-project' },
	];

	test.each([
		['with a spread on a tag', `---\nconst props = { source: 'main-gitlab', group: 'platform' };\n---\n<GitlabGroupList {...props} />`],
		['with a computed Project', `{['platform/backend/api'].map((item) => <GitlabReadme source={source} project={item} />)}`],
		['with a Route name rebound in a loop', `{['main-gitlab'].map((source) => <GitlabGroupList source={source} group="platform" />)}`],
		['with a computed Source', `---\nconst chosen = sources.find(({ type }) => type === 'gitlab').name;\n---\n<GitlabGroupList source={chosen} group={group} />`],
		['with a Fragment', '<Fragment set:html={"<b>raw</b>"} />'],
		['with an optional prop', '<GroupMembers source={source} group={group} deep />'],
		['with a shorthand prop', '<GitlabGroupList {source} {group} />'],
	])('%s', async (_, template) => {
		const fake = await startFakeGitlab({ groups, projects });
		const vitrine = await startVitrine({ sources: [gitlab(fake.url)], routes: routes(template) });

		const response = await fetch(`${vitrine.url}/gitlab/platform`);
		const html = await response.text();

		await vitrine.stop();
		await fake.stop();
		expect(response.status).toBe(200);
		expect(html).not.toContain('This page could not be shown');
	});
});

describe('the warning that Templates run as code', () => {
	const source = { name: 'main-harbor', type: 'harbor', url: 'http://127.0.0.1:9', projects: ['platform'] };
	const template = '---\nthrow new Error("ran although disabled");\n---\n<h2>From the Template</h2>';
	const withTemplates = { sources: [source], routes: [{ url: '/images', controller: 'harbor-images', template }, { url: '/plain', controller: 'harbor-images' }] };
	const withoutTemplates = { sources: [source], routes: [{ url: '/images', controller: 'harbor-images' }] };
	const broken = { sources: [source], routes: [{ url: '/images', controller: 'harbor-images', template: '<div>{' }] };
	const disabledPage = async (settings: unknown, env: Record<string, string>) => {
		const vitrine = await startVitrine(settings, env);
		const html = await (await fetch(`${vitrine.url}/images`)).text();
		const stderr = vitrine.stderr();
		await vitrine.stop();
		return { html, stderr };
	};

	test('is logged when Vitrine compiles Templates', async () => {
		const vitrine = await startVitrine(withTemplates);
		const stderr = vitrine.stderr();

		await vitrine.stop();
		expect(stderr).toContain('run as code');
		expect(stderr).toContain('"/images"');
		expect(stderr).not.toContain('"/plain"');
	});

	test('stays away when there is no Template', async () => {
		const vitrine = await startVitrine(withoutTemplates);
		const stderr = vitrine.stderr();

		await vitrine.stop();
		expect(stderr).not.toContain('Template');
	});

	test('is logged once under astro dev', async () => {
		const vitrine = await startDevVitrine(withTemplates);
		const stderr = vitrine.stderr();

		await vitrine.stop();
		expect(stderr.match(/run as code/g)).toHaveLength(1);
	}, 60_000);

	test.each([
		['1', '1'],
		['false', 'false'],
		['0', '0'],
	])('names the ignored Templates, with Templates off for the value %s', async (_, value) => {
		const { html, stderr } = await disabledPage(withTemplates, { VITRINE_TEMPLATE_DISABLE: value });

		expect(html).toContain('<h1>Images</h1>');
		expect(html).not.toContain('From the Template');
		expect(html).not.toContain('This page could not be shown');
		expect(stderr).not.toContain('ran although disabled');
		expect(stderr).toContain('VITRINE_TEMPLATE_DISABLE');
		expect(stderr).toContain('"/images"');
		expect(stderr).not.toContain('run as code');
	});

	test('skips the startup checks with Templates off', async () => {
		const { html } = await disabledPage(broken, { VITRINE_TEMPLATE_DISABLE: '1' });

		expect(html).toContain('<h1>Images</h1>');
	});

	test('leaves Templates on for an empty value', async () => {
		const { html } = await disabledPage(withTemplates, { VITRINE_TEMPLATE_DISABLE: '' });

		expect(html).toContain('This page could not be shown');
	});

	test('reads the flag from an env file', async () => {
		const { html } = await disabledPage(withTemplates, { VITRINE_ENV_FILE: writeEnvFile('VITRINE_TEMPLATE_DISABLE=1\n') });

		expect(html).toContain('<h1>Images</h1>');
	});
});

test('leaves the page of a subject that could not be loaded as it is', async () => {
	const gitlab = await startFakeGitlab({ groups, projects });
	gitlab.behave('down');
	const vitrine = await startVitrine({
		sources: [{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform'] }],
		routes: [
			{ url: '/gitlab/:group+', controller: 'gitlab-group', template: rearranged },
			{ url: '/gitlab/:group+/-/:project', controller: 'gitlab-project' },
		],
	});

	const html = await (await fetch(`${vitrine.url}/gitlab/platform`)).text();

	await vitrine.stop();
	await gitlab.stop();
	expect(html).toContain('platform could not be loaded from main-gitlab.');
	expect(html).not.toContain('Rearranged page');
});
