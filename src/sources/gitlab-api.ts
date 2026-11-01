import { ContentUnavailableError } from '../content-cache.ts';
import type { GitlabSource } from '../settings.ts';

const PAGE_SIZE = 100;
// A Project page shows the latest of these, so one request is enough.
const LATEST_COMMITS = 10;
const LATEST_ISSUES = 10;
const LATEST_RELEASES = 5;
const TOP_CONTRIBUTORS = 10;
const CARD_CONTRIBUTORS = 5;
// A card takes several requests, so a page of cards must not send them all at once.
export const CARDS_AT_ONCE = 5;
// Members take a request per Group, Project and Member, which must not all go at once.
export const MEMBER_READS_AT_ONCE = 10;
// What GitLab starts the usernames of access token bots and service accounts with. A renamed service account no longer matches.
const BOT_USERNAMES = /^(?:(?:project|group)_\d+_bot|service_account_)/;

export interface Group {
	path: string;
	name: string;
	description: string;
	webUrl: string;
}

export interface Project {
	id: number;
	path: string;
	name: string;
	description: string;
	lastActivityAt: string;
	topics: string[];
	/** Left out for an empty repository, which GitLab still names a default branch for and answers 404 about. */
	defaultBranch?: string;
	webUrl: string;
}

/** What a Project card adds to the list, which takes several requests per Project. */
export interface ProjectCard {
	/** GitLab keeps this from anyone below the Reporter role. */
	commitCount?: number;
	latestRelease?: string;
	contributors: { name: string; avatarUrl?: string }[];
}

/** Everything a Main Group holds, starting with the Main Group itself. */
export interface MainGroupContent {
	groups: Group[];
	projects: Project[];
}

export interface Readme {
	markdown: string;
	/** Where a relative link of the README leads. */
	linkBase: string;
	/** Where a relative image of the README loads from. */
	imageBase: string;
}

export interface Commit {
	title: string;
	authorName: string;
	committedAt: string;
	webUrl: string;
}

export interface Issue {
	title: string;
	/** The path of its Project, so that a Group can select its own from the Main Group's list. */
	project: string;
	assignees: string[];
	labels: string[];
	webUrl: string;
}

export interface Release {
	name: string;
	tagName: string;
	releasedAt: string;
	webUrl?: string;
}

export interface Contributor {
	name: string;
	commits: number;
}

/** A Member as GitLab's member lists give them. */
export interface Member {
	id: number;
	username: string;
	name: string;
	avatarUrl?: string;
	/** Each Group and Project the person is a member of, so that a Group can select its own from the Main Group's list. */
	paths: string[];
}

/** What a profile adds to a Member, which takes a request per Member. */
export interface MemberProfile {
	location?: string;
	email?: string;
	bot?: boolean;
}

export type DetailedMember = Member & MemberProfile;

export interface Epic {
	title: string;
	webUrl: string;
	startDate?: string;
	dueDate?: string;
	description?: string;
	assignees: { name: string; avatarUrl?: string }[];
	weight?: number;
	/** The Issues beneath the Epic, at any depth. */
	issues: { all: number; closed: number };
}

interface GitlabGroup {
	full_path: string;
	name: string;
	description: string | null;
	web_url: string;
}

interface GitlabProject {
	id: number;
	path_with_namespace: string;
	name: string;
	description: string | null;
	last_activity_at: string;
	topics: string[];
	default_branch: string | null;
	empty_repo: boolean;
	web_url: string;
}

interface GitlabCommit {
	title: string;
	author_name: string;
	committed_date: string;
	web_url: string;
}

interface GitlabIssue {
	title: string;
	confidential: boolean;
	references: { full: string };
	assignees: { name: string }[];
	labels: string[];
	web_url: string;
}

interface GitlabRelease {
	name: string;
	tag_name: string;
	released_at: string;
	_links?: { self?: string };
}

interface GitlabContributor {
	name: string;
	email: string;
	commits: number;
}

interface GitlabMember {
	id: number;
	username: string;
	name: string;
	state: string;
	avatar_url: string | null;
}

/** Leaves out the private email, which GitLab adds to a profile read with a GitLab admin's token. */
interface GitlabProfile {
	location: string | null;
	public_email: string | null;
	/** GitLab's example of a profile read with a GitLab admin's token leaves this out. */
	bot?: boolean;
}

/** The fields of every widget asked for, as each widget answers only its own. */
interface GitlabEpicWidget {
	startDate?: string | null;
	dueDate?: string | null;
	description?: string | null;
	assignees?: { nodes: { name: string; avatarUrl: string | null }[] };
	weight?: number | null;
	rolledUpWeight?: number | null;
	rolledUpCountsByType?: { workItemType: { name: string }; countsByState: { all: number; closed: number } }[];
}

interface GitlabEpic {
	title: string;
	confidential: boolean;
	webUrl: string;
	widgets: GitlabEpicWidget[];
}

interface GitlabEpicsPage {
	workItemTypes: { nodes: { name: string }[] };
	workItems: {
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
		nodes: GitlabEpic[];
	};
}

export async function readMainGroup(source: GitlabSource, mainGroup: string, signal: AbortSignal): Promise<MainGroupContent> {
	const path = `/groups/${encodeURIComponent(mainGroup)}`;
	const [group, subgroups, projects] = await Promise.all([
		fetchJson<GitlabGroup>(source, path, { with_projects: 'false' }, signal),
		// GitLab otherwise leaves out the groups the token can read without being a member.
		fetchAllPages<GitlabGroup>(source, `${path}/descendant_groups`, { all_available: 'true' }, signal),
		// GitLab otherwise adds the Projects shared into the Main Group, which are not beneath it.
		fetchAllPages<GitlabProject>(source, `${path}/projects`, { include_subgroups: 'true', with_shared: 'false', archived: 'false', order_by: 'name', sort: 'asc' }, signal),
	]);
	return {
		groups: [group, ...subgroups].map((item) => ({
			path: item.full_path,
			name: item.name,
			description: item.description ?? '',
			webUrl: item.web_url,
		})),
		projects: projects.map((item) => ({
			id: item.id,
			path: item.path_with_namespace,
			name: item.name,
			description: item.description ?? '',
			lastActivityAt: item.last_activity_at,
			topics: item.topics,
			defaultBranch: item.empty_repo ? undefined : (item.default_branch ?? undefined),
			webUrl: item.web_url,
		})),
	};
}

// Epics are work items since GitLab 18.1, and the REST and GraphQL Epic APIs are deprecated in their favour.
const EPICS_QUERY = `query Epics($fullPath: ID!, $types: [IssueType!], $state: IssuableState, $confidential: Boolean, $includeDescendants: Boolean, $first: Int, $after: String) {
	group(fullPath: $fullPath) {
		workItemTypes { nodes { name } }
		workItems(types: $types, state: $state, confidential: $confidential, includeDescendants: $includeDescendants, first: $first, after: $after) {
			pageInfo { hasNextPage endCursor }
			nodes {
				title
				confidential
				webUrl
				widgets(onlyTypes: [START_AND_DUE_DATE, DESCRIPTION, ASSIGNEES, WEIGHT, HIERARCHY]) {
					... on WorkItemWidgetStartAndDueDate { startDate dueDate }
					... on WorkItemWidgetDescription { description }
					... on WorkItemWidgetAssignees { assignees { nodes { name avatarUrl } } }
					... on WorkItemWidgetWeight { weight rolledUpWeight }
					... on WorkItemWidgetHierarchy { rolledUpCountsByType { workItemType { name } countsByState { all closed } } }
				}
			}
		}
	}
}`;

/** A GitLab without Epics, which no retry would change, unlike a Source that is down. */
export class EpicsUnavailableError extends ContentUnavailableError {}

export async function readEpics(source: GitlabSource, mainGroup: string, signal: AbortSignal): Promise<Epic[]> {
	const epics: Epic[] = [];
	let after: string | null = null;
	do {
		const { workItemTypes, workItems } = await readEpicsPage(source, mainGroup, after, signal);
		const { pageInfo, nodes } = workItems;
		// A tier without Epics answers an empty list, and only lacks the type. Types can be renamed, so listed Epics settle it.
		if (nodes.length === 0 && !after && !workItemTypes.nodes.some(({ name }) => name === 'Epic')) {
			throw new EpicsUnavailableError(`GitLab "${source.name}" has no Epics for "${mainGroup}"`);
		}
		// Checked again, as a confidential Epic must not reach the cache whatever the filter did.
		for (const epic of nodes) {
			if (!epic.confidential) epics.push(toEpic(source, epic));
		}
		after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
	} while (after);
	return epics;
}

function toEpic(source: GitlabSource, { title, webUrl, widgets }: GitlabEpic): Epic {
	const { startDate, dueDate, description, assignees, weight, rolledUpWeight, rolledUpCountsByType }: GitlabEpicWidget = Object.assign({}, ...widgets);
	return {
		title,
		webUrl,
		startDate: startDate ?? undefined,
		dueDate: dueDate ?? undefined,
		description: description ?? undefined,
		// Unlike the REST API, GraphQL answers an avatar uploaded to GitLab with a path.
		assignees: (assignees?.nodes ?? []).map(({ name, avatarUrl }) => ({ name, avatarUrl: avatarUrl ? new URL(avatarUrl, source.url).href : undefined })),
		weight: weight ?? rolledUpWeight ?? undefined,
		issues: rolledUpCountsByType?.find(({ workItemType }) => workItemType.name === 'Issue')?.countsByState ?? { all: 0, closed: 0 },
	};
}

async function readEpicsPage(source: GitlabSource, mainGroup: string, after: string | null, signal: AbortSignal): Promise<GitlabEpicsPage> {
	const variables = { fullPath: mainGroup, types: ['EPIC'], state: 'opened', confidential: false, includeDescendants: true, first: PAGE_SIZE, after };
	const { group } = await fetchGraphql<{ group: GitlabEpicsPage | null }>(source, EPICS_QUERY, variables, signal);
	if (!group) throw new Error(`GitLab "${source.name}" holds no Group "${mainGroup}" for this reader`);
	return group;
}

/** GitLab has no list of everyone beneath a Group, so each Group and Project takes a request. */
export async function readMembers(source: GitlabSource, { groups, projects }: { groups: Pick<Group, 'path'>[]; projects: Project[] }, signal: AbortSignal): Promise<Member[]> {
	const lists = await inBatches(
		[
			// Only a Group's full list holds who it inherits, which a Project's would repeat.
			...groups.map(({ path }) => ({ path, url: `/groups/${encodeURIComponent(path)}/members/all` })),
			...projects.map(({ id, path }) => ({ path, url: `/projects/${id}/members` })),
		],
		MEMBER_READS_AT_ONCE,
		async ({ path, url }) => ({ path, accounts: await fetchAllPages<GitlabMember>(source, url, {}, signal) }),
	);

	const members = new Map<number, Member>();
	for (const { path, accounts } of lists) {
		for (const { id, username, name, state, avatar_url } of accounts) {
			if (state !== 'active') continue;
			const member = members.get(id) ?? { id, username, name, avatarUrl: avatar_url ?? undefined, paths: [] };
			member.paths.push(path);
			members.set(id, member);
		}
	}
	return [...members.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * GitLab keeps location, email and whether an account is a bot to a Member's profile. Nothing comes back for a profile
 * it holds back or cannot find, which no retry would change, so such an account never stops the profiles after it.
 */
export async function readMemberProfile(source: GitlabSource, { id }: Member, signal: AbortSignal): Promise<MemberProfile | undefined> {
	const profile = await fetchIfAllowed<GitlabProfile>(source, `/users/${id}`, {}, signal, [401, 403, 404]);
	return profile && { location: profile.location || undefined, email: profile.public_email || undefined, bot: profile.bot };
}

/** A profile settles it. Member lists say nothing about bots, so without one only the username can tell. */
export function isBot({ username, bot }: DetailedMember): boolean {
	return bot ?? BOT_USERNAMES.test(username);
}

/** Only a Markdown README can be rendered, and GitLab names whichever README it finds. */
export async function readReadme(source: GitlabSource, { id, defaultBranch, webUrl }: Project, signal: AbortSignal): Promise<Readme | undefined> {
	if (!defaultBranch) return undefined;
	const { readme_url } = await fetchJson<{ readme_url: string | null }>(source, `/projects/${id}`, {}, signal);
	const file = readme_url?.split(`/-/blob/${defaultBranch}/`)[1];
	if (!file || !/\.(md|markdown)$/i.test(file)) return undefined;

	const response = await fetchApi(source, `/projects/${id}/repository/files/${encodeURIComponent(file)}/raw`, { ref: defaultBranch }, signal);
	return { markdown: await response.text(), linkBase: `${webUrl}/-/blob/${defaultBranch}/`, imageBase: `${webUrl}/-/raw/${defaultBranch}/` };
}

export async function listCommits(source: GitlabSource, { id, defaultBranch }: Project, signal: AbortSignal): Promise<Commit[]> {
	if (!defaultBranch) return [];
	const commits = await fetchJson<GitlabCommit[]>(source, `/projects/${id}/repository/commits`, { per_page: String(LATEST_COMMITS) }, signal);
	return commits.map(({ title, author_name, committed_date, web_url }) => ({ title, authorName: author_name, committedAt: committed_date, webUrl: web_url }));
}

export async function listIssues(source: GitlabSource, { id }: Project, signal: AbortSignal): Promise<Issue[]> {
	const query = { state: 'opened', confidential: 'false', order_by: 'created_at', sort: 'desc', per_page: String(LATEST_ISSUES) };
	return toIssues(await fetchJson<GitlabIssue[]>(source, `/projects/${id}/issues`, query, signal));
}

export async function readIssues(source: GitlabSource, mainGroup: string, signal: AbortSignal): Promise<Issue[]> {
	const query = { state: 'opened', confidential: 'false', order_by: 'created_at', sort: 'desc' };
	return toIssues(await fetchAllPages<GitlabIssue>(source, `/groups/${encodeURIComponent(mainGroup)}/issues`, query, signal));
}

/** Checked again, as a confidential Issue must not reach the cache whatever the filter did. */
function toIssues(issues: GitlabIssue[]): Issue[] {
	return issues
		.filter(({ confidential }) => !confidential)
		.map(({ title, references, assignees, labels, web_url }) => ({ title, project: references.full.split('#')[0], assignees: assignees.map(({ name }) => name), labels, webUrl: web_url }));
}

export async function listReleases(source: GitlabSource, { id }: Project, signal: AbortSignal): Promise<Release[]> {
	const releases = await fetchJson<GitlabRelease[]>(source, `/projects/${id}/releases`, { per_page: String(LATEST_RELEASES) }, signal);
	return releases.map(({ name, tag_name, released_at, _links }) => ({ name, tagName: tag_name, releasedAt: released_at, webUrl: _links?.self }));
}

/** Leaves out the email GitLab gives for each contributor. */
export async function listContributors(source: GitlabSource, { id, defaultBranch }: Project, signal: AbortSignal): Promise<Contributor[]> {
	if (!defaultBranch) return [];
	const contributors = await fetchTopContributors(source, id, TOP_CONTRIBUTORS, signal);
	return contributors.map(({ name, commits }) => ({ name, commits }));
}

export async function readProjectCard(source: GitlabSource, { id, defaultBranch }: Project, signal: AbortSignal): Promise<ProjectCard> {
	const [project, releases, contributors] = await Promise.all([
		fetchJson<{ statistics?: { commit_count: number } }>(source, `/projects/${id}`, { statistics: 'true' }, signal),
		// GitLab refuses releases on a Project that turned them off.
		fetchIfAllowed<GitlabRelease[]>(source, `/projects/${id}/releases`, { per_page: '1' }, signal),
		defaultBranch ? fetchTopContributors(source, id, CARD_CONTRIBUTORS, signal) : [],
	]);
	return {
		commitCount: project.statistics?.commit_count,
		latestRelease: releases?.[0]?.name,
		contributors: await Promise.all(contributors.map(async ({ name, email }) => ({ name, avatarUrl: await readAvatarUrl(source, email, signal) }))),
	};
}

function fetchTopContributors(source: GitlabSource, id: number, count: number, signal: AbortSignal) {
	const query = { order_by: 'commits', sort: 'desc', per_page: String(count) };
	return fetchJson<GitlabContributor[]>(source, `/projects/${id}/repository/contributors`, query, signal);
}

/** GitLab answers null for an email it cannot match, and refuses anonymous readers when public visibility is restricted. */
async function readAvatarUrl(source: GitlabSource, email: string, signal: AbortSignal): Promise<string | undefined> {
	const avatar = await fetchIfAllowed<{ avatar_url: string | null }>(source, '/avatar', { email }, signal);
	return avatar?.avatar_url ?? undefined;
}

async function inBatches<T, R>(items: T[], size: number, read: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	for (let start = 0; start < items.length; start += size) {
		results.push(...(await Promise.all(items.slice(start, start + size).map(read))));
	}
	return results;
}

async function fetchGraphql<T>(source: GitlabSource, query: string, variables: Record<string, unknown>, signal: AbortSignal): Promise<T> {
	const path = '/api/graphql';
	const response = await fetch(`${baseUrl(source)}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(source.token ? { authorization: `Bearer ${source.token}` } : {}) },
		body: JSON.stringify({ query, variables }),
		signal,
	});
	assertOk(source, path, response);

	const { data, errors } = await response.json();
	// GitLab answers 200 for a query it could not run.
	if (errors?.length) throw answerError(source, path, `"${errors[0].message}"`);
	return data;
}

async function fetchJson<T>(source: GitlabSource, path: string, query: Record<string, string>, signal: AbortSignal): Promise<T> {
	const response = await fetchApi(source, path, query, signal);
	return response.json();
}

async function fetchAllPages<T>(source: GitlabSource, path: string, query: Record<string, string>, signal: AbortSignal): Promise<T[]> {
	const items: T[] = [];
	for (let page = 1; ; page++) {
		const batch = await fetchJson<T[]>(source, path, { ...query, page: String(page), per_page: String(PAGE_SIZE) }, signal);
		items.push(...batch);
		if (batch.length < PAGE_SIZE) return items;
	}
}

async function fetchIfAllowed<T>(source: GitlabSource, path: string, query: Record<string, string>, signal: AbortSignal, refusals = [401, 403]): Promise<T | undefined> {
	const response = await request(source, path, query, signal);
	if (refusals.includes(response.status)) return undefined;
	assertOk(source, path, response);
	return response.json();
}

async function fetchApi(source: GitlabSource, path: string, query: Record<string, string>, signal: AbortSignal): Promise<Response> {
	const response = await request(source, path, query, signal);
	assertOk(source, path, response);
	return response;
}

function assertOk(source: GitlabSource, path: string, response: Response) {
	if (!response.ok) throw answerError(source, path, response.status);
}

function answerError(source: GitlabSource, path: string, answer: number | string) {
	return new Error(`GitLab "${source.name}" answered ${answer} for ${path}`);
}

function request(source: GitlabSource, path: string, query: Record<string, string>, signal: AbortSignal): Promise<Response> {
	const url = new URL(`${baseUrl(source)}/api/v4${path}`);
	url.search = new URLSearchParams(query).toString();

	return fetch(url, { headers: source.token ? { 'private-token': source.token } : {}, signal });
}

/** A GitLab can live under a path of its own, which a URL built from a leading slash would lose. */
function baseUrl(source: GitlabSource) {
	return source.url.replace(/\/$/, '');
}
