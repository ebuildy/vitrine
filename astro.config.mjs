// @ts-check
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';
import { checkLogLevel } from './src/logger.mjs';
import { loadEnvFile, prepareSettings } from './src/settings.ts';

// Before the config is read, so that a LOG_LEVEL kept in the env file applies to Astro's messages from the start.
loadEnvFile();
checkLogLevel();

// https://astro.build/config
export default defineConfig({
	output: 'server',
	// Astro's own messages use the format of Vitrine's.
	logger: { entrypoint: './src/logger.mjs' },
	// Middleware mode stops the built entry from serving by itself, so start.ts can check Settings first.
	adapter: node({ mode: 'middleware' }),
	integrations: [
		{
			name: 'vitrine-settings',
			hooks: {
				'astro:server:setup': prepareSettings,
			},
		},
	],
});
