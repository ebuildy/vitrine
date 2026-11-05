import type { MiddlewareHandler } from 'astro';
import { recordRender } from './metrics.ts';
import { forgetPage, recordVisit } from './visited-pages.ts';

/**
 * Records every page that answers with status 200, for /sitemap.xml, leaving out its query, which only varies a page, and
 * forgets one that is not found any more.
 * Holds back a page with a Template until it is complete. Every other page streams, so that a slow Source does not delay its start.
 * Times the render of each Route's pages, until the response starts for a page that streams and until it is complete for a Template.
 */
export const onRequest: MiddlewareHandler = async ({ locals, url }, next) => {
	const started = performance.now();
	const response = await next();
	if (response.status === 200 && response.headers.get('content-type')?.startsWith('text/html')) recordVisit(url.pathname);
	else if (response.status === 404) forgetPage(url.pathname);
	const result = locals.showsTemplate ? new Response(await response.text(), response) : response;
	if (locals.routeTemplate !== undefined) recordRender(locals.routeTemplate, (performance.now() - started) / 1000);
	return result;
};
