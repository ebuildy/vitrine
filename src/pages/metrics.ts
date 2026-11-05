import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { getCacheStore } from '../cache-stores.ts';
import { metricsContentType, metricsText } from '../metrics.ts';
import { getSettings } from '../settings.ts';

function sameSecret(given: string, expected: string) {
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Serves the metrics in Prometheus text format, to whoever bears METRICS_TOKEN when it is set, and to anyone when it is not. */
export const GET: APIRoute = async ({ request }) => {
	if (!getSettings().metrics.enabled) return new Response(null, { status: 404 });

	const token = process.env.METRICS_TOKEN;
	if (token) {
		const given = /^Bearer (.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
		if (given === undefined || !sameSecret(given, token)) return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } });
	}
	// Creates the cache store if no page has yet, so that its gauges are there from the first scrape.
	getCacheStore();
	return new Response(await metricsText(), { headers: { 'content-type': metricsContentType(), 'cache-control': 'no-store' } });
};
