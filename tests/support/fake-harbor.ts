import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeHarborOptions {
	/** Repository names per Harbor project, e.g. { platform: ['platform/api'] } */
	projects: Record<string, string[]>;
	/** When set, requests must carry these credentials. */
	credentials?: { username: string; password: string };
}

export interface FakeHarbor {
	url: string;
	/** Every request received, as path and query. */
	requests: string[];
	stop: () => Promise<void>;
}

/** Answers the parts of Harbor's v2 API that Vitrine reads. */
export async function startFakeHarbor({ projects, credentials }: FakeHarborOptions): Promise<FakeHarbor> {
	const requests: string[] = [];
	const handle = (request: IncomingMessage, response: ServerResponse) => {
		const url = new URL(request.url ?? '/', 'http://fake-harbor');
		requests.push(`${url.pathname}${url.search}`);
		if (credentials && request.headers.authorization !== basicAuth(credentials)) {
			response.writeHead(401).end();
			return;
		}
		const match = url.pathname.match(/^\/api\/v2\.0\/projects\/([^/]+)\/repositories$/);
		const repositories = match && projects[match[1]];
		if (!repositories) {
			response.writeHead(404).end();
			return;
		}
		const page = Number(url.searchParams.get('page') ?? 1);
		const pageSize = Number(url.searchParams.get('page_size') ?? 10);
		const items = repositories.slice((page - 1) * pageSize, page * pageSize).map((name) => ({ name }));
		response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(items));
	};

	const server = createServer(handle);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		requests,
		stop: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

function basicAuth({ username, password }: { username: string; password: string }) {
	return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}
