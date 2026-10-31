/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		globalSetup: ['./tests/support/global-setup.ts'],
		testTimeout: 20_000,
		hookTimeout: 30_000,
	},
});
