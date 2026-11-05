import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startFakeHarbor } from './support/fake-harbor.ts';
import type { FakeHarbor } from './support/fake-harbor.ts';
import { startupFailure, startVitrine } from './support/vitrine.ts';
import type { RunningVitrine } from './support/vitrine.ts';

describe('a branded installation', () => {
	let harbor: FakeHarbor;
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		harbor = await startFakeHarbor({ projects: { platform: ['platform/api'] } });
		vitrine = await startVitrine({
			sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'] }],
			routes: [{ url: '/images', controller: 'harbor-images' }],
			branding: { siteName: 'Acme Portal', logo: 'https://cdn.acme.test/logo.svg' },
			navigation: [
				{ label: 'Images', url: '/images' },
				{ label: 'Handbook & FAQ', url: 'https://docs.acme.test/' },
				{ label: 'Launches', url: '/launches', icon: ':rocket:' },
				{ label: 'Code', url: 'https://gitlab.acme.test/', icon: 'gitlab' },
				{ label: 'Status', url: 'https://status.acme.test/', icon: 'https://cdn.acme.test/status.svg' },
				{ label: 'Wiki', url: '/wiki', icon: '/assets/wiki.png' },
			],
			theme: { primary: '#0a7', background: 'rgb(250 250 240)', dark: { primary: '#5fd' } },
		});
	});

	afterAll(async () => {
		await vitrine?.stop();
		await harbor?.stop();
	});

	test('shows the site name and logo on a page', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		expect(html).toContain('Acme Portal');
		expect(html).toMatch(/<img[^>]+src="https:\/\/cdn\.acme\.test\/logo\.svg"/);
	});

	test('shows the Menu in the order of Settings', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		const [, nav] = /<nav[^>]*>(.*?)<\/nav>/s.exec(html) ?? [];
		// The label is the last text of each link, after any icon.
		expect([...nav.matchAll(/<a[^>]+href="([^"]+)"[^>]*>.*?([^<>]+)<\/a>/gs)].map(([, href, label]) => [href, label])).toEqual([
			['/images', 'Images'],
			['https://docs.acme.test/', 'Handbook &amp; FAQ'],
			['/launches', 'Launches'],
			['https://gitlab.acme.test/', 'Code'],
			['https://status.acme.test/', 'Status'],
			['/wiki', 'Wiki'],
		]);
	});

	test('shows the icon of a Menu item before its label, hidden from screen readers', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		const [, nav] = /<nav[^>]*>(.*?)<\/nav>/s.exec(html) ?? [];
		const linkTo = (href: string) => new RegExp(`<a[^>]+href="${href}"[^>]*>(.*?)</a>`, 's').exec(nav)?.[1] ?? '';
		expect(linkTo('/launches')).toMatch(/^<span[^>]+aria-hidden="true"[^>]*>🚀<\/span>Launches$/);
		expect(linkTo('https://gitlab.acme.test/')).toMatch(/^<img[^>]+src="(data:image\/svg\+xml|\/_astro\/)[^"]+"[^>]*>Code$/);
		expect(linkTo('https://status.acme.test/')).toMatch(/^<img[^>]+src="https:\/\/cdn\.acme\.test\/status\.svg"[^>]*>Status$/);
		expect(linkTo('/wiki')).toMatch(/^<img[^>]+src="\/assets\/wiki\.png"[^>]*>Wiki$/);
		for (const img of nav.match(/<img[^>]*>/g) ?? []) {
			expect(img).toContain('alt=""');
			expect(img).toContain('aria-hidden="true"');
		}
	});

	test('shows a Menu item without an icon as only its label', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		const [, nav] = /<nav[^>]*>(.*?)<\/nav>/s.exec(html) ?? [];
		expect(nav).toMatch(/<a[^>]+href="\/images"[^>]*>Images<\/a>/);
	});

	test('marks the Menu item of the current page', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		const [, nav] = /<nav[^>]*>(.*?)<\/nav>/s.exec(html) ?? [];
		expect([...nav.matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]+)</g)].map(([, label]) => label)).toEqual(['Images']);
	});

	test('sets the Theme as CSS variables, for light mode and for dark mode', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		const [, style] = /<html[^>]+style="([^"]*)"/.exec(html) ?? [];
		expect(style).toContain('--color-primary-light:#0a7');
		expect(style).toContain('--color-background-light:rgb(250 250 240)');
		expect(style).toContain('--color-primary-dark:#5fd');
		expect(style).not.toContain('--color-background-dark');
		expect(style).not.toContain('--color-text');
	});

	test('offers the colour modes in the site header, shown only once its script runs', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		const [, header] = /<header class="site-header[^>]*>(.*?)<\/header>/s.exec(html) ?? [];
		const [select] = /<select[^>]*>/.exec(header) ?? [];
		expect(select).toContain('aria-label="Colour mode"');
		expect(select).toContain('hidden');
		expect([...header.matchAll(/<option value="(\w+)"[^>]*>([^<]+)</g)].map(([, value, label]) => [value, label.trim()])).toEqual([
			['system', 'System'],
			['light', 'Light'],
			['dark', 'Dark'],
		]);
	});

	test('applies a remembered colour mode in <head>, before the page paints', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		const head = html.slice(0, html.indexOf('</head>'));
		expect(head).toMatch(/<script>[^<]*localStorage[^<]*colorMode[^<]*<\/script>/);
	});

	test('has no named Theme by default', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		expect(html).not.toMatch(/<html[^>]+data-theme=/);
	});

	test('keeps the Branding on the not-found page', async () => {
		const response = await fetch(`${vitrine.url}/nowhere`);

		expect(response.status).toBe(404);
		const html = await response.text();
		expect(html).toContain('Acme Portal');
		expect(html).toContain('--color-primary-light:#0a7');
	});

	test('does not link the site name home without a Route at the root URL', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		expect(html).toMatch(/<span[^>]+class="site-name/);
	});
});

describe('an installation with no Branding', () => {
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		vitrine = await startVitrine({ sources: [], routes: [{ url: '/', controller: 'harbor-images' }] });
	});

	afterAll(async () => {
		await vitrine?.stop();
	});

	test('calls itself Vitrine, links home and has no logo or Menu', async () => {
		const html = await (await fetch(`${vitrine.url}/`)).text();

		expect(html).toMatch(/<a[^>]+href="\/"[^>]*>\s*Vitrine\s*<\/a>/);
		expect(html).not.toContain('<img');
		expect(html).not.toContain('<nav');
	});
});

describe('startup', () => {
	test.each([
		['a logo at a page-relative address', { branding: { logo: 'logo.svg' } }, 'branding.logo: must start with'],
		['a Menu item at a page-relative address', { navigation: [{ label: 'Images', url: 'images' }] }, 'navigation.0.url: must start with'],
		['a Menu item at a script address', { navigation: [{ label: 'Images', url: 'javascript:alert(1)' }] }, 'navigation.0.url: must start with'],
		['a Menu item with no label', { navigation: [{ url: '/images' }] }, 'navigation.0.label'],
		['a Menu icon that is no emoji', { navigation: [{ label: 'Images', url: '/images', icon: ':not-an-emoji:' }] }, 'navigation.0.icon: :not-an-emoji: is not an emoji shortcode'],
		['a Menu icon the build does not carry', { navigation: [{ label: 'Images', url: '/images', icon: 'nexus' }] }, 'navigation.0.icon: must be an emoji shortcode like :rocket:, one of gitlab, harbor, or a URL'],
		['a Menu icon at a plain-HTTP address', { navigation: [{ label: 'Images', url: '/images', icon: 'http://cdn.acme.test/icon.svg' }] }, 'navigation.0.icon: must be'],
		['a Menu icon at a page-relative address', { navigation: [{ label: 'Images', url: '/images', icon: 'icon.svg' }] }, 'navigation.0.icon: must be'],
		['a colour that would end the CSS declaration', { theme: { primary: 'red; color: blue' } }, 'theme.primary: must be a CSS colour'],
		['a Theme colour that does not exist', { theme: { accent: 'red' } }, 'accent'],
		['a dark colour that would end the CSS declaration', { theme: { dark: { primary: 'red; color: blue' } } }, 'theme.dark.primary: must be a CSS colour'],
		['a dark colour that does not exist', { theme: { dark: { accent: 'red' } } }, 'accent'],
		['a Theme name that does not exist', { theme: { name: 'pirate' } }, 'theme.name'],
		['CSS that would close its <style>', { theme: { css: ['a { color: red } </style><script>'] } }, 'theme.css.0: must not contain </style>'],
		['a CSS item that is neither CSS, a URL nor a file', { theme: { css: ['brand.css'] } }, 'theme.css.0: must be CSS'],
		['a CSS file that does not exist', { theme: { css: ['./missing.css'] } }, 'theme.css.0: cannot read'],
	])('stops on %s', async (_, settings, problem) => {
		const { exitCode, problems } = await startupFailure({ sources: [], routes: [], ...settings });

		expect(exitCode).toBe(1);
		expect(problems).toContainEqual(expect.stringContaining(problem));
	});
});

describe('an installation with a named Theme', () => {
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		vitrine = await startVitrine({ sources: [], routes: [{ url: '/', controller: 'harbor-images' }], theme: { name: 'naval', primary: '#c00' } });
	});

	afterAll(async () => {
		await vitrine?.stop();
	});

	test('names the Theme on the page, and keeps the colours Settings override', async () => {
		const html = await (await fetch(`${vitrine.url}/`)).text();

		const [, attributes] = /<html([^>]*)>/.exec(html) ?? [];
		expect(attributes).toContain('data-theme="naval"');
		expect(attributes).toContain('style="--color-primary-light:#c00"');
	});
});

describe('an installation with its own CSS', () => {
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		vitrine = await startVitrine(
			{
				sources: [],
				routes: [{ url: '/', controller: 'harbor-images' }],
				theme: {
					css: ['https://cdn.acme.test/brand.css', './styles/local.css', 'h1 { letter-spacing: 0.1em; }', '/assets/proxied.css'],
				},
			},
			{},
			{ 'styles/local.css': '.from-a-file { color: teal; }' },
		);
	});

	afterAll(async () => {
		await vitrine?.stop();
	});

	test('adds each stylesheet in the order of Settings, after its own', async () => {
		const html = await (await fetch(`${vitrine.url}/`)).text();

		const added = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"|<style>([^<]*)<\/style>/g)].map(([, href, css]) => href ?? css);
		expect(added.slice(-4)).toEqual(['https://cdn.acme.test/brand.css', '.from-a-file { color: teal; }', 'h1 { letter-spacing: 0.1em; }', '/assets/proxied.css']);
		// Astro inlines Vitrine's own CSS when it is small, and links to it otherwise.
		expect(added.slice(0, -4).some((item) => item.includes('--color-primary') || item.startsWith('/_astro/'))).toBe(true);
	});
});
