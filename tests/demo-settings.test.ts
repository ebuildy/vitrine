import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { withSourceUrls } from '../demo/settings.ts';
import { loadSettings } from '../src/settings.ts';
import { writeSettings } from './support/vitrine.ts';

const demoSettings = readFileSync('demo/settings.yaml', 'utf8');
const env = { GITLAB_TOKEN: 'token', HARBOR_PASSWORD: 'password' };

describe('the demo Settings', () => {
	test('point every Source at the port its fake listens on', () => {
		const urls = { 'main-harbor': 'http://127.0.0.1:50001', 'tools-harbor': 'http://127.0.0.1:50002', 'main-gitlab': 'http://127.0.0.1:50003' };

		const settings = loadSettings(writeSettings(withSourceUrls(demoSettings, urls)), env);

		expect(settings.sources.map(({ name, url }) => [name, url])).toEqual([
			['main-harbor', 'http://127.0.0.1:50001'],
			['tools-harbor', 'http://127.0.0.1:50002'],
			['main-gitlab', 'http://127.0.0.1:50003'],
		]);
		expect(settings.routes.find(({ url }) => url === '/welcome')?.template).toContain('Welcome to the demo');
	});

	test('refuse a Source that has no fake, naming it', () => {
		expect(() => withSourceUrls(demoSettings, { 'main-harbor': 'http://127.0.0.1:50001' })).toThrow('tools-harbor');
	});
});
