// @ts-check
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';
import { prepareSettings } from './src/settings.ts';

// https://astro.build/config
export default defineConfig({
	output: 'server',
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
