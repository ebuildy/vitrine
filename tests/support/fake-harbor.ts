import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeHarborOptions {
	/** Repository names per Harbor project, e.g. { platform: ['platform/api'] } */
	projects: Record<string, string[]>;
	/** Harbor's own artifact JSON per repository, e.g. { 'platform/api': [{ size: 1, tags: [] }] } */
	artifacts?: Record<string, FakeArtifact[]>;
	/** Harbor's own JSON per project, where summary is left out when Harbor refuses it to this reader. */
	projectDetails?: Record<string, { creation_time: string; repo_count: number; summary?: Record<string, unknown> }>;
	/** When set, requests must carry these credentials. */
	credentials?: { username: string; password: string };
	/** Any free port when left out. */
	port?: number;
}

export type FakeArtifact = Record<string, unknown>;

/** up answers at once, slow after a short wait, down with a 503, and hanging never. down-after-repositories only fails artifact requests, and down-after-projects only summary requests. */
export type FakeHarborBehaviour = 'up' | 'slow' | 'down' | 'down-after-repositories' | 'down-after-projects' | 'hanging';

export interface FakeHarbor {
	url: string;
	/** Every request received, as path and query. */
	requests: string[];
	/** The requests that list a project's repositories, of which a load of one project makes one per page. */
	repositoryListRequests: () => string[];
	/** Changes how the following requests are answered. */
	behave: (behaviour: FakeHarborBehaviour) => void;
	stop: () => Promise<void>;
}

/** Answers the parts of Harbor's v2 API that Vitrine reads. */
export async function startFakeHarbor({ projects, artifacts = {}, projectDetails = {}, credentials, port: requestedPort = 0 }: FakeHarborOptions): Promise<FakeHarbor> {
	const requests: string[] = [];
	let behaviour: FakeHarborBehaviour = 'up';
	const handle = async (request: IncomingMessage, response: ServerResponse) => {
		const url = new URL(request.url ?? '/', 'http://fake-harbor');
		requests.push(`${url.pathname}${url.search}`);
		if (behaviour === 'hanging') return;
		if (
			behaviour === 'down' ||
			(behaviour === 'down-after-repositories' && url.pathname.endsWith('/artifacts')) ||
			(behaviour === 'down-after-projects' && url.pathname.endsWith('/summary'))
		) {
			response.writeHead(503).end();
			return;
		}
		if (behaviour === 'slow') await new Promise((resolve) => setTimeout(resolve, 200));
		if (credentials && request.headers.authorization !== basicAuth(credentials)) {
			response.writeHead(401).end();
			return;
		}
		const names = Object.keys(projects);
		if (url.pathname === '/api/v2.0/projects') {
			const items = names.map((name, index) => {
				const { summary, ...details } = projectDetails[name] ?? { creation_time: '2025-01-01T00:00:00.000Z', repo_count: 0 };
				return { project_id: index + 1, name, ...details };
			});
			respondWithPage(response, url, items);
			return;
		}
		const summaryMatch = url.pathname.match(/^\/api\/v2\.0\/projects\/(\d+)\/summary$/);
		if (summaryMatch) {
			const summary = projectDetails[names[Number(summaryMatch[1]) - 1]]?.summary;
			if (summary) response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(summary));
			else response.writeHead(403).end();
			return;
		}
		const repositoriesMatch = url.pathname.match(/^\/api\/v2\.0\/projects\/([^/]+)\/repositories$/);
		const repositories = repositoriesMatch && projects[repositoriesMatch[1]];
		if (repositories) {
			respondWithPage(response, url, repositories.map((name) => ({ name })));
			return;
		}
		const artifactsMatch = url.pathname.match(/^\/api\/v2\.0\/projects\/([^/]+)\/repositories\/([^/]+)\/artifacts$/);
		const repository = artifactsMatch && repositoryName(artifactsMatch[1], artifactsMatch[2]);
		if (repository && projects[artifactsMatch[1]]?.includes(repository)) {
			const withScanOverview = url.searchParams.get('with_scan_overview') === 'true';
			const items = (artifacts[repository] ?? []).map(({ scan_overview, ...artifact }) =>
				withScanOverview ? { ...artifact, scan_overview } : artifact,
			);
			respondWithPage(response, url, items);
			return;
		}
		response.writeHead(404).end();
	};

	const server = createServer(handle);
	await new Promise<void>((resolve) => server.listen(requestedPort, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		requests,
		repositoryListRequests: () => requests.filter((request) => /\/repositories\?/.test(request)),
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

function respondWithPage(response: ServerResponse, url: URL, items: unknown[]) {
	const page = Number(url.searchParams.get('page') ?? 1);
	const pageSize = Number(url.searchParams.get('page_size') ?? 10);
	response
		.writeHead(200, { 'content-type': 'application/json' })
		.end(JSON.stringify(items.slice((page - 1) * pageSize, page * pageSize)));
}

/** Harbor wants the slashes of a repository name encoded twice, and answers 404 to a single encoding. */
function repositoryName(project: string, encoded: string) {
	return /%2f/i.test(encoded) ? undefined : `${project}/${decodeURIComponent(decodeURIComponent(encoded))}`;
}

function basicAuth({ username, password }: { username: string; password: string }) {
	return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}
