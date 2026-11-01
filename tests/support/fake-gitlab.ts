import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeGitlabGroup {
	path: string;
	name?: string;
	description?: string;
	/** GitLab leaves such a group out unless asked for everything the reader can see. */
	notMember?: boolean;
}

export interface FakeGitlabProject {
	path: string;
	description?: string | null;
	last_activity_at?: string;
	topics?: string[];
	/** GitLab keeps statistics from anyone below the Reporter role, so leave this out to be such a reader. */
	commit_count?: number;
	archived?: boolean;
	/** Main Groups this Project is shared into from outside, which GitLab lists unless told otherwise. */
	sharedInto?: string[];
	/** The content of README.md, left out when the Project has none. */
	readme?: string;
	/** GitLab still names a default branch then, and answers 404 about the repository. */
	empty_repo?: boolean;
	/** GitLab's own JSON, newest first. */
	commits?: Record<string, unknown>[];
	issues?: Record<string, unknown>[];
	releases?: Record<string, unknown>[];
	contributors?: { name: string; email: string; commits: number }[];
}

export interface FakeGitlabOptions {
	groups: FakeGitlabGroup[];
	projects?: FakeGitlabProject[];
	/** Avatar URLs per email, where GitLab answers null for any other. */
	avatars?: Record<string, string>;
	/** Whether this GitLab refuses avatars to its reader, as it does anonymous ones when public visibility is restricted. */
	avatarsRefused?: boolean;
	/** When set, requests must carry this token. */
	token?: string;
}

/** up answers at once, slow after a short wait, down with a 503, and hanging never. The after-lists variants only hit requests about one Project. */
export type FakeGitlabBehaviour = 'up' | 'slow' | 'down' | 'down-after-lists' | 'hanging' | 'hanging-after-lists';

export interface FakeGitlab {
	url: string;
	/** Every request received, as path and query. */
	requests: string[];
	/** The requests that list the Projects of a Main Group, of which a load makes one per page. */
	projectListRequests: () => string[];
	/** Changes how the following requests are answered. */
	behave: (behaviour: FakeGitlabBehaviour) => void;
	stop: () => Promise<void>;
}

/** Answers the parts of GitLab's v4 API that Vitrine reads. */
export async function startFakeGitlab({ groups, projects = [], avatars = {}, avatarsRefused, token }: FakeGitlabOptions): Promise<FakeGitlab> {
	const requests: string[] = [];
	let behaviour: FakeGitlabBehaviour = 'up';
	let baseUrl = '';

	const groupJson = ({ path, name, description }: FakeGitlabGroup) => ({
		full_path: path,
		name: name ?? lastSegment(path),
		description: description ?? '',
		web_url: `${baseUrl}/groups/${path}`,
	});
	const projectJson = (project: FakeGitlabProject) => ({
		id: projects.indexOf(project) + 1,
		path_with_namespace: project.path,
		name: lastSegment(project.path),
		description: project.description ?? null,
		last_activity_at: project.last_activity_at ?? '2026-01-01T00:00:00.000Z',
		topics: project.topics ?? [],
		default_branch: 'main',
		empty_repo: project.empty_repo ?? false,
		web_url: `${baseUrl}/${project.path}`,
	});

	const handle = async (request: IncomingMessage, response: ServerResponse) => {
		const url = new URL(request.url ?? '/', 'http://fake-gitlab');
		requests.push(`${url.pathname}${url.search}`);
		if (behaviour === 'hanging' || (behaviour === 'hanging-after-lists' && url.pathname.startsWith('/api/v4/projects/'))) return;
		if (behaviour === 'down' || (behaviour === 'down-after-lists' && url.pathname.startsWith('/api/v4/projects/'))) {
			response.writeHead(503).end();
			return;
		}
		if (behaviour === 'slow') await new Promise((resolve) => setTimeout(resolve, 200));
		if (token && request.headers['private-token'] !== token) {
			response.writeHead(401).end();
			return;
		}

		if (url.pathname === '/api/v4/avatar') {
			if (avatarsRefused) response.writeHead(403).end();
			else respondWithJson(response, { avatar_url: avatars[url.searchParams.get('email') ?? ''] ?? null });
			return;
		}

		const groupMatch = url.pathname.match(/^\/api\/v4\/groups\/([^/]+)(\/descendant_groups|\/projects)?$/);
		const groupPath = groupMatch && decodeURIComponent(groupMatch[1]);
		const group = groups.find(({ path }) => path === groupPath);
		if (groupMatch && group) {
			if (groupMatch[2] === '/descendant_groups') {
				const everything = url.searchParams.get('all_available') === 'true';
				const descendants = groups.filter(({ path, notMember }) => path.startsWith(`${group.path}/`) && (everything || !notMember));
				respondWithPage(response, url, descendants.map(groupJson));
			} else if (groupMatch[2] === '/projects') {
				const beneath = (project: FakeGitlabProject) =>
					url.searchParams.get('include_subgroups') === 'true'
						? project.path.startsWith(`${group.path}/`)
						: parentOf(project.path) === group.path;
				const listed = projects.filter(
					(project) =>
						(beneath(project) || (url.searchParams.get('with_shared') !== 'false' && project.sharedInto?.includes(group.path))) &&
						(url.searchParams.get('archived') !== 'false' || !project.archived),
				);
				respondWithPage(response, url, listed.map(projectJson));
			} else {
				respondWithJson(response, groupJson(group));
			}
			return;
		}

		const projectMatch = url.pathname.match(/^\/api\/v4\/projects\/(\d+)(\/.*)?$/);
		const project = projectMatch && projects[Number(projectMatch[1]) - 1];
		if (projectMatch && project) {
			const part = projectMatch[2];
			if (part === undefined) {
				const branch = projectJson(project).default_branch;
				const readme = project.readme === undefined ? null : `${baseUrl}/${project.path}/-/blob/${branch}/README.md`;
				const statistics = url.searchParams.get('statistics') === 'true' && project.commit_count !== undefined;
				respondWithJson(response, {
					...projectJson(project),
					readme_url: readme,
					...(statistics ? { statistics: { commit_count: project.commit_count } } : {}),
				});
			} else if (part?.startsWith('/repository/') && project.empty_repo) {
				response.writeHead(404).end();
			} else if (part === '/repository/files/README.md/raw' && project.readme !== undefined) {
				response.writeHead(200, { 'content-type': 'text/plain' }).end(project.readme);
			} else if (part === '/repository/commits') {
				respondWithPage(response, url, project.commits ?? []);
			} else if (part === '/repository/contributors') {
				respondWithPage(response, url, sortedContributors(project, url));
			} else if (part === '/issues') {
				const issues = (project.issues ?? []).filter(
					({ state, confidential }) =>
						(url.searchParams.get('state') !== 'opened' || state === 'opened') &&
						(url.searchParams.get('confidential') !== 'false' || !confidential),
				);
				respondWithPage(response, url, issues);
			} else if (part === '/releases') {
				respondWithPage(response, url, project.releases ?? []);
			} else {
				response.writeHead(404).end();
			}
			return;
		}
		response.writeHead(404).end();
	};

	const server = createServer(handle);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	baseUrl = `http://127.0.0.1:${port}`;
	return {
		url: baseUrl,
		requests,
		projectListRequests: () => requests.filter((request) => /\/groups\/[^/]+\/projects\?/.test(request)),
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

/** GitLab orders contributors by commit date unless told otherwise, and lowest first unless told otherwise. */
function sortedContributors({ contributors = [] }: FakeGitlabProject, url: URL) {
	if (url.searchParams.get('order_by') !== 'commits') return contributors;
	const direction = url.searchParams.get('sort') === 'desc' ? -1 : 1;
	return contributors.toSorted((a, b) => direction * (a.commits - b.commits));
}

function respondWithJson(response: ServerResponse, body: unknown) {
	response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function respondWithPage(response: ServerResponse, url: URL, items: unknown[]) {
	const page = Number(url.searchParams.get('page') ?? 1);
	const perPage = Number(url.searchParams.get('per_page') ?? 20);
	respondWithJson(response, items.slice((page - 1) * perPage, page * perPage));
}

function lastSegment(path: string) {
	return path.slice(path.lastIndexOf('/') + 1);
}

function parentOf(path: string) {
	return path.slice(0, path.lastIndexOf('/'));
}
