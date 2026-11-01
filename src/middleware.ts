import type { MiddlewareHandler } from 'astro';

/** Holds back a page with a Template until it is complete. Every other page streams, so that a slow Source does not delay its start. */
export const onRequest: MiddlewareHandler = async ({ locals }, next) => {
	const response = await next();
	return locals.showsTemplate ? new Response(await response.text(), response) : response;
};
