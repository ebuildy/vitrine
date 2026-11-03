declare namespace App {
	interface Locals {
		/** Set by a page that renders a Template, for the middleware. */
		showsTemplate?: boolean;
	}
}

/**
 * Lets `tsc` resolve `.astro` imports in `.ts` files. TypeScript 7.0 cannot read `.astro` files;
 * drop this for `@astrojs/ts-content-mapper` once TypeScript 7.1 ships.
 */
declare module '*.astro' {
	const Component: import('astro/runtime/server/index.js').AstroComponentFactory;
	export default Component;
}
