import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

interface EpicsVariables {
	fullPath: string;
	types: string[];
	state: string;
	confidential?: boolean;
	includeDescendants?: boolean;
	first: number;
	after?: string | null;
}

/** A Member of a Group or Project, as their GitLab profile holds them. */
export interface FakeGitlabMember {
	id: number;
	name: string;
	/** Made from the name when left out. */
	username?: string;
	/** GitLab's own value, which is active unless set. */
	state?: string;
	avatar_url?: string | null;
	/** Left out, GitLab answers null. */
	location?: string | null;
	public_email?: string | null;
	bot?: boolean;
	/** The private email, which GitLab only gives a GitLab admin's token: set it to be read with one. */
	email?: string;
	/** What GitLab answers for this profile instead of giving it. */
	profileStatus?: number;
}

/** An Epic of a Group. */
export interface FakeGitlabEpic {
	title: string;
	/** GitLab's own value, which is opened unless set. */
	state?: 'opened' | 'closed';
	confidential?: boolean;
	startDate?: string;
	dueDate?: string;
	description?: string;
	/** An avatar is a path on GitLab, unlike in its REST API, for one uploaded to GitLab. */
	assignees?: { name: string; avatarUrl?: string }[];
	weight?: number;
	rolledUpWeight?: number;
	/** The Issues beneath the Epic, at any depth. */
	issues?: { all: number; closed: number };
}

export interface FakeGitlabGroup {
	path: string;
	name?: string;
	description?: string;
	/** GitLab leaves such a group out unless asked for everything the reader can see. */
	notMember?: boolean;
	/** Direct members. GitLab adds those of the ancestor groups only when asked for all of them. */
	members?: FakeGitlabMember[];
	/** Groups invited into this one, whose direct members GitLab adds only when asked for all of them. */
	invitedGroups?: string[];
	epics?: FakeGitlabEpic[];
	/** A tier without Epics, where GitLab lists none and answers no error, and only its work item types tell. */
	epicsUnavailable?: boolean;
	/** What this GitLab calls Epics in its work item types, as these became configurable in GitLab 19.0. */
	epicTypeName?: string;
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
	/** Direct members. */
	members?: FakeGitlabMember[];
}

export interface FakeGitlabOptions {
	groups: FakeGitlabGroup[];
	projects?: FakeGitlabProject[];
	/** Avatar URLs per email, where GitLab answers null for any other. */
	avatars?: Record<string, string>;
	/** Whether this GitLab refuses avatars to its reader, as it does anonymous ones when public visibility is restricted. */
	avatarsRefused?: boolean;
	/** Whether this GitLab refuses Member profiles to its reader. */
	profilesRefused?: boolean;
	/** Whether this GitLab leaves the confidential filter of its GraphQL API unapplied. */
	confidentialFilterIgnored?: boolean;
	/** What GitLab's GraphQL API answers instead of data, with a 200 as ever. */
	graphqlError?: string;
	/** When set, requests must carry this token. */
	token?: string;
	/** Any free port when left out. */
	port?: number;
}

/**
 * up answers at once, slow after a short wait, down with a 503, and hanging never.
 * The after-lists variants only hit requests about one Project, the members of a Group or Epics, and the profiles
 * variants only Member profiles.
 */
export type FakeGitlabBehaviour = 'up' | 'slow' | 'down' | 'down-after-lists' | 'down-profiles' | 'hanging' | 'hanging-after-lists' | 'hanging-profiles';

export interface FakeGitlab {
	url: string;
	/** Every request received, as path and query. */
	requests: string[];
	/** The requests that list the Projects of a Main Group, of which a load makes one per page. */
	projectListRequests: () => string[];
	/** The requests that read anything about Members. */
	memberRequests: () => string[];
	/** The requests to the GraphQL API, which only Epics are read through. */
	graphqlRequests: () => string[];
	/** Changes how the following requests are answered. */
	behave: (behaviour: FakeGitlabBehaviour) => void;
	stop: () => Promise<void>;
}

/** Answers the parts of GitLab's v4 and GraphQL APIs that Vitrine reads. */
export async function startFakeGitlab({
	groups,
	projects = [],
	avatars = {},
	avatarsRefused,
	profilesRefused,
	confidentialFilterIgnored,
	graphqlError,
	token,
	port: requestedPort = 0,
}: FakeGitlabOptions): Promise<FakeGitlab> {
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
	/** GitLab keeps location, public email and whether an account is a bot to its profile. */
	const memberJson = ({ id, name, username, state, avatar_url }: FakeGitlabMember) => ({
		id,
		username: username ?? name.toLowerCase().replaceAll(' ', '.'),
		name,
		state: state ?? 'active',
		avatar_url: avatar_url ?? null,
		web_url: `${baseUrl}/users/${id}`,
	});
	const profileJson = (member: FakeGitlabMember) => ({
		...memberJson(member),
		location: member.location ?? null,
		public_email: member.public_email ?? null,
		bot: member.bot ?? false,
		...(member.email ? { email: member.email } : {}),
	});
	const groupsHolding = (path: string) => groups.filter((group) => path === group.path || path.startsWith(`${group.path}/`));
	const allMembers = () => [...groups, ...projects].flatMap(({ members = [] }) => members);

	/** Answers what readEpics asks in variables, as GitLab would answer the query. */
	const epicsJson = ({ fullPath, types, state, confidential, includeDescendants, first, after }: EpicsVariables) => {
		const group = groups.find(({ path }) => path === fullPath);
		if (!group) return { group: null };

		const held = groups.filter(({ path, epicsUnavailable }) => !epicsUnavailable && (path === group.path || (includeDescendants && path.startsWith(`${group.path}/`))));
		const listed = held
			.flatMap(({ path, epics = [] }) => epics.map((epic, index) => ({ ...epic, webUrl: `${baseUrl}/groups/${path}/-/work_items/${index + 1}` })))
			.filter((epic) => types.includes('EPIC') && (epic.state ?? 'opened') === state && (confidential !== false || confidentialFilterIgnored || !epic.confidential));
		const start = Number(after ?? 0);
		const end = start + first;
		return {
			group: {
				workItemTypes: { nodes: [...(group.epicsUnavailable ? [] : [{ name: group.epicTypeName ?? 'Epic' }]), { name: 'Issue' }, { name: 'Task' }] },
				workItems: {
					pageInfo: { hasNextPage: end < listed.length, endCursor: listed.length > 0 ? String(end) : null },
					nodes: listed.slice(start, end).map(({ title, confidential, webUrl, startDate, dueDate, description, assignees = [], weight, rolledUpWeight, issues }) => ({
						title,
						confidential: confidential ?? false,
						webUrl,
						widgets: [
							{ startDate: startDate ?? null, dueDate: dueDate ?? null },
							{ description: description ?? null },
							{ assignees: { nodes: assignees.map(({ name, avatarUrl }) => ({ name, avatarUrl: avatarUrl ?? null })) } },
							{ weight: weight ?? null, rolledUpWeight: rolledUpWeight ?? null },
							{
								rolledUpCountsByType: [
									{ workItemType: { name: 'Epic' }, countsByState: { all: 0, closed: 0 } },
									{ workItemType: { name: 'Issue' }, countsByState: issues ?? { all: 0, closed: 0 } },
								],
							},
						],
					})),
				},
			},
		};
	};

	const handle = async (request: IncomingMessage, response: ServerResponse) => {
		const url = new URL(request.url ?? '/', 'http://fake-gitlab');
		requests.push(`${url.pathname}${url.search}`);
		const graphql = url.pathname === '/api/graphql';
		const afterLists = graphql || url.pathname.startsWith('/api/v4/projects/') || /^\/api\/v4\/groups\/[^/]+\/members/.test(url.pathname);
		const aboutProfile = url.pathname.startsWith('/api/v4/users/');
		if (behaviour === 'hanging' || (behaviour === 'hanging-after-lists' && afterLists) || (behaviour === 'hanging-profiles' && aboutProfile)) return;
		if (behaviour === 'down' || (behaviour === 'down-after-lists' && afterLists) || (behaviour === 'down-profiles' && aboutProfile)) {
			response.writeHead(503).end();
			return;
		}
		if (behaviour === 'slow') await new Promise((resolve) => setTimeout(resolve, 200));
		if (token && (graphql ? request.headers.authorization !== `Bearer ${token}` : request.headers['private-token'] !== token)) {
			response.writeHead(401).end();
			return;
		}

		if (graphql) {
			if (request.method !== 'POST') response.writeHead(405).end();
			else if (graphqlError) respondWithJson(response, { errors: [{ message: graphqlError }] });
			else respondWithJson(response, { data: epicsJson((await readJson(request)).variables) });
			return;
		}

		if (url.pathname === '/api/v4/avatar') {
			if (avatarsRefused) response.writeHead(403).end();
			else respondWithJson(response, { avatar_url: avatars[url.searchParams.get('email') ?? ''] ?? null });
			return;
		}

		const profileMatch = url.pathname.match(/^\/api\/v4\/users\/(\d+)$/);
		if (profileMatch) {
			const member = allMembers().find(({ id }) => id === Number(profileMatch[1]));
			if (profilesRefused) response.writeHead(403).end();
			else if (member?.profileStatus) response.writeHead(member.profileStatus).end();
			else if (member) respondWithJson(response, profileJson(member));
			else response.writeHead(404).end();
			return;
		}

		const groupMatch = url.pathname.match(/^\/api\/v4\/groups\/([^/]+)(\/descendant_groups|\/projects|\/members|\/members\/all)?$/);
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
			} else if (groupMatch[2] === '/members') {
				respondWithPage(response, url, (group.members ?? []).map(memberJson));
			} else if (groupMatch[2] === '/members/all') {
				const holding = groupsHolding(group.path);
				const invited = groups.filter(({ path }) => holding.some(({ invitedGroups = [] }) => invitedGroups.includes(path)));
				const all = [...holding, ...invited].flatMap(({ members = [] }) => members);
				respondWithPage(response, url, [...new Map(all.map((member) => [member.id, member])).values()].map(memberJson));
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
			} else if (part === '/members') {
				respondWithPage(response, url, (project.members ?? []).map(memberJson));
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
	await new Promise<void>((resolve) => server.listen(requestedPort, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	baseUrl = `http://127.0.0.1:${port}`;
	return {
		url: baseUrl,
		requests,
		projectListRequests: () => requests.filter((request) => /\/groups\/[^/]+\/projects\?/.test(request)),
		memberRequests: () => requests.filter((request) => /\/members|\/users\//.test(request)),
		graphqlRequests: () => requests.filter((request) => request === '/api/graphql'),
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

async function readJson(request: IncomingMessage) {
	let body = '';
	for await (const chunk of request) body += chunk;
	return JSON.parse(body);
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
