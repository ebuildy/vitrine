import { afterEach, describe, expect, test } from 'vitest';
import { startFakeNexus } from './support/fake-nexus.ts';
import type { FakeNexusBehaviour } from './support/fake-nexus.ts';
import { startupFailure, startVitrine } from './support/vitrine.ts';

const ONE_MILLISECOND = 1 / 60_000;
const repositories = [{ name: 'maven-releases', format: 'maven2', type: 'hosted' }];

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
	const deadline = Date.now() + timeoutMs;
	while (!(await condition())) {
		if (Date.now() > deadline) throw new Error('The condition never held');
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

describe('a warm-up in Settings', () => {
	const cleanups: (() => Promise<unknown>)[] = [];

	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
	});

	async function start(warmUp: Record<string, unknown> | undefined, { behaviour = 'up', source = {} }: { behaviour?: FakeNexusBehaviour; source?: Record<string, unknown> } = {}) {
		const nexus = await startFakeNexus({ repositories });
		nexus.behave(behaviour);
		const vitrine = await startVitrine({
			sources: [{ name: 'main-nexus', type: 'nexus', url: nexus.url, ...source }],
			routes: [
				{ url: '/nexus/:source', controller: 'nexus' },
				{ url: '/search', controller: 'search' },
			],
			navigation: [{ label: 'Repositories', url: '/nexus/main-nexus' }],
			...(warmUp && { warmUp }),
		});
		cleanups.push(() => vitrine.stop(), nexus.stop);
		const sitemap = async () => (await fetch(`${vitrine.url}/sitemap.xml`)).text();
		return { nexus, vitrine, sitemap };
	}

	test('is off by default', async () => {
		const { nexus, sitemap } = await start(undefined);

		await new Promise((resolve) => setTimeout(resolve, 500));

		expect(nexus.requests).toEqual([]);
		expect(await sitemap()).not.toContain('<url>');
	});

	test('at start fills the cache from every fixed Route and the Menu, before any Visitor comes', async () => {
		const { nexus, vitrine, sitemap } = await start({ atStart: true });

		await until(async () => (await sitemap()).includes('/nexus/main-nexus'));

		expect(await sitemap()).toContain(`<loc>${vitrine.url}/search</loc>`);
		expect(nexus.requests.length).toBeGreaterThan(0);
	});

	test('at start does not delay the server from answering, even with a Source that hangs', async () => {
		const { vitrine } = await start({ atStart: true }, { behaviour: 'hanging' });

		const started = Date.now();
		const response = await fetch(`${vitrine.url}/sitemap.xml`);

		expect(response.status).toBe(200);
		expect(Date.now() - started).toBeLessThan(1_000);
	});

	test('logs its report, naming a Source that is down', async () => {
		const { vitrine } = await start({ atStart: true }, { behaviour: 'down' });

		await until(() => vitrine.stderr().includes('Warm-up of'));

		expect(vitrine.stderr()).toContain('failed /nexus/main-nexus: Repositories could not be loaded because main-nexus is down.');
		expect(vitrine.stderr()).toMatch(/visited 2 pages, 1 failed, in/);
	});

	test('runs again on its interval', async () => {
		const { nexus } = await start({ everyMinutes: 0.005, concurrency: 1 }, { source: { allowedAgeMinutes: ONE_MILLISECOND } });

		await until(() => nexus.requests.length >= 3);
	});
});

describe('invalid warm-up Settings stop startup', () => {
	test.each([
		['an interval of zero', { everyMinutes: 0 }, 'warmUp.everyMinutes'],
		['a concurrency of zero', { concurrency: 0 }, 'warmUp.concurrency'],
		['a concurrency that is no whole number', { concurrency: 1.5 }, 'warmUp.concurrency'],
		['an unknown key', { atstart: true }, 'warmUp'],
	])('with %s', async (_, warmUp, expectedError) => {
		const { exitCode, output } = await startupFailure({ sources: [], routes: [{ url: '/search', controller: 'search' }], warmUp });

		expect(exitCode).toBe(1);
		expect(output).toContain(expectedError);
	});
});
