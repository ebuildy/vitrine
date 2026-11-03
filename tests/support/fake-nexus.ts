import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Nexus's own JSON for a repository, which also carries the url and attributes Vitrine ignores. */
export interface FakeNexusRepository {
	name: string;
	format: string;
	type: string;
}

export interface FakeNexusOptions {
	repositories: FakeNexusRepository[];
	/** When set, requests must carry these credentials. */
	credentials?: { username: string; password: string };
	/** Any free port when left out. */
	port?: number;
}

/** up answers at once, slow after a short wait, down with a 503, and hanging never. */
export type FakeNexusBehaviour = 'up' | 'slow' | 'down' | 'hanging';

export interface FakeNexus {
	url: string;
	/** Every request received, as path and query. */
	requests: string[];
	/** Changes how the following requests are answered. */
	behave: (behaviour: FakeNexusBehaviour) => void;
	stop: () => Promise<void>;
}

/** Answers the parts of the Nexus Repository REST API that Vitrine reads. */
export async function startFakeNexus({ repositories, credentials, port: requestedPort = 0 }: FakeNexusOptions): Promise<FakeNexus> {
	const requests: string[] = [];
	let behaviour: FakeNexusBehaviour = 'up';
	let url = '';
	const handle = async (request: IncomingMessage, response: ServerResponse) => {
		const requested = new URL(request.url ?? '/', 'http://fake-nexus');
		requests.push(`${requested.pathname}${requested.search}`);
		if (behaviour === 'hanging') return;
		if (behaviour === 'down') {
			response.writeHead(503).end();
			return;
		}
		if (behaviour === 'slow') await new Promise((resolve) => setTimeout(resolve, 200));
		if (credentials && request.headers.authorization !== basicAuth(credentials)) {
			response.writeHead(401).end();
			return;
		}
		// Nexus may be served under a path of its own, such as /nexus, set by its context path.
		const list = requested.pathname.match(/^(\/[^/]+)?\/service\/rest\/v1\/repositories$/);
		if (list) {
			// Nexus answers the whole list at once, with no pages.
			const items = repositories.map((repository) => ({ ...repository, url: `${url}${list[1] ?? ''}/repository/${repository.name}`, attributes: {} }));
			response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(items));
			return;
		}
		response.writeHead(404).end();
	};

	const server = createServer(handle);
	await new Promise<void>((resolve) => server.listen(requestedPort, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	url = `http://127.0.0.1:${port}`;
	return {
		url,
		requests,
		behave: (next) => {
			behaviour = next;
		},
		stop: () =>
			new Promise((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections();
			}),
	};
}

function basicAuth({ username, password }: { username: string; password: string }) {
	return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}
