import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	globalSetup: './tests/support/global-setup.ts',
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
