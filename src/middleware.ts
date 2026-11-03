import type { MiddlewareHandler } from 'astro';
import { recordVisit } from './visited-pages.ts';

/**
 * Records every page that answers with status 200, for /sitemap.xml, leaving out its query, which only varies a page.
 * Holds back a page with a Template until it is complete. Every other page streams, so that a slow Source does not delay its start.
 */
export const onRequest: MiddlewareHandler = async ({ locals, url }, next) => {
	const response = await next();
	if (response.status === 200 && response.headers.get('content-type')?.startsWith('text/html')) recordVisit(url.pathname);
	return locals.showsTemplate ? new Response(await response.text(), response) : response;
};
