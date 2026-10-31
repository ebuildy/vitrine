// @ts-check
import { fileURLToPath } from 'node:url';
import base from '../astro.config.mjs';

// Adds the pages a fork would add, without shipping them in the real build.
export default {
	...base,
	root: fileURLToPath(new URL('..', import.meta.url)),
	integrations: [
		{
			name: 'fork-pages',
			hooks: {
				/** @param {import('astro').HookParameters<'astro:config:setup'>} options */
				'astro:config:setup': ({ injectRoute }) => {
					injectRoute({ pattern: '/fork-page', entrypoint: './tests/fixtures/ForkPage.astro' });
				},
			},
		},
	],
};
