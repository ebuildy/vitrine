import type { APIRoute } from 'astro';
import { visitTimes } from '../visited-pages.ts';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function escapeXml(text: string) {
	return text.replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/**
 * The origin the client asked for, as Astro trusts no Host header and would answer localhost. The sitemap is built for each
 * request and never cached, so a forged Host only changes the answer its own sender reads.
 */
function requestedOrigin(request: Request) {
	const host = request.headers.get('host');
	const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
	try {
		return host ? new URL(`${protocol === 'https' ? 'https' : new URL(request.url).protocol.slice(0, -1)}://${host}`).origin : undefined;
	} catch {
		return undefined;
	}
}

/** Lists every page visited with status 200, by a Visitor or a warm-up, with the time of its last visit. */
export const GET: APIRoute = async ({ request, url }) => {
	const origin = requestedOrigin(request) ?? url.origin;
	const pages = Object.entries(await visitTimes()).sort(([a], [b]) => a.localeCompare(b));
	const entries = pages.map(([path, at]) => `<url><loc>${escapeXml(new URL(path, origin).href)}</loc><lastmod>${new Date(at).toISOString()}</lastmod></url>`);
	const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...entries, '</urlset>', ''].join('\n');
	return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
