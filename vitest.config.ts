/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { getViteConfig } from 'astro/config';
import { configDefaults } from 'vitest/config';

// Vitest runs Astro's dev hooks, which must not read an installation's own Settings or .env file.
process.env.VITRINE_SETTINGS = resolve('tests/fixtures/settings.yaml');
process.env.VITRINE_ENV_FILE = resolve('tests/fixtures/no-such.env');

export default getViteConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		globalSetup: ['./tests/support/global-setup.ts'],
		testTimeout: 20_000,
		hookTimeout: 30_000,
		// Vitest's own reporters stay, so the terminal, agents and GitHub Actions print as before.
		// The HTML report lands outside test-results/, which every Playwright run wipes.
		coverage: {
			provider: 'v8',
			// Every file of src/, so a module no test imports shows as 0 % instead of missing.
			include: ['src/**/*.{ts,mjs,astro}', 'start.ts', 'warm-up.ts'],
			exclude: ['src/env.d.ts'],
			reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
			reportsDirectory: 'coverage',
			// The floor sits a little under the measured coverage: a pull request that drops it goes red.
			// Raise these as coverage grows. Tests that start Vitrine as a child process (tests/support/vitrine.ts)
			// do not count: v8 only sees this process.
			thresholds: { statements: 60, branches: 55, functions: 65, lines: 60 },
		},
		reporters: [...configDefaults.reporters, ['html', { outputDir: 'vitest-report' }]],
	},
});
