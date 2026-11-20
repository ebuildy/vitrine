import type { MiddlewareHandler } from 'astro';
import { metricsResponse } from './metrics-response.ts';
import { recordRequest } from './metrics.ts';
import { getSettings } from './settings.ts';
import { forgetPage, recordVisit } from './visited-pages.ts';

/**
 * Records every page that answers with status 200, for /sitemap.xml, leaving out its query, which only varies a page, and
 * forgets one that is not found any more.
 * Holds back a page with a Template until it is complete. Every other page streams, so that a slow Source does not delay its start.
 * Serves the metrics at `metrics.path` ahead of any Route, unless `metrics.enabled` is false: then a Route of Settings may use that URL.
 * Counts the pages of each Route by status class, and times their render: until the response starts for a page that streams, and until it is
 * complete for a Template. A request that matches no Route counts as `unmatched`, and Vitrine's own pages, such as /sitemap.xml, count for none.
 */
export const onRequest: MiddlewareHandler = async ({ locals, request, url }, next) => {
	const { enabled, path } = getSettings().metrics;
	if (enabled && url.pathname === path && request.method === 'GET') return metricsResponse(request);
	const started = performance.now();
	// Astro renders the 404 page for a 404 through this middleware again, with the same locals, and one request counts once.
	const record = (status: number) => {
		if (locals.routeTemplate === undefined || locals.requestCounted) return;
		locals.requestCounted = true;
		recordRequest(locals.routeTemplate, status, (performance.now() - started) / 1000);
	};
	let response: Response;
	try {
		response = await next();
	} catch (error) {
		record(500);
		throw error;
	}
	if (response.status === 200 && response.headers.get('content-type')?.startsWith('text/html')) recordVisit(url.pathname);
	else if (response.status === 404) forgetPage(url.pathname);
	const result = locals.showsTemplate ? new Response(await response.text(), response) : response;
	record(result.status);
	return result;
};
