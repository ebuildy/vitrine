import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	globalSetup: './tests/support/global-setup.ts',
	reporter: [[process.env.CI ? 'dot' : 'list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
	use: { trace: 'retain-on-failure' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
