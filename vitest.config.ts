/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { getViteConfig } from 'astro/config';

// Vitest runs Astro's dev hooks, which must not read an installation's own Settings.
process.env.VITRINE_SETTINGS = resolve('tests/fixtures/settings.yaml');

export default getViteConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		globalSetup: ['./tests/support/global-setup.ts'],
		testTimeout: 20_000,
		hookTimeout: 30_000,
	},
});
