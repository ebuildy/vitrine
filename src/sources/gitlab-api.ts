import type { GitlabSource } from '../settings.ts';

const PAGE_SIZE = 100;
// A Project page shows the latest of these, so one request is enough.
const LATEST_COMMITS = 10;
const LATEST_ISSUES = 10;
const LATEST_RELEASES = 5;
const TOP_CONTRIBUTORS = 10;
const CARD_CONTRIBUTORS = 5;

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
	const issues = await fetchJson<GitlabIssue[]>(source, `/projects/${id}/issues`, query, signal);
	return issues.map(({ title, assignees, labels, web_url }) => ({ title, assignees: assignees.map(({ name }) => name), labels, webUrl: web_url }));
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

async function fetchIfAllowed<T>(source: GitlabSource, path: string, query: Record<string, string>, signal: AbortSignal): Promise<T | undefined> {
	const response = await request(source, path, query, signal);
	if (response.status === 401 || response.status === 403) return undefined;
	if (!response.ok) throw new Error(`GitLab "${source.name}" answered ${response.status} for ${path}`);
	return response.json();
}

async function fetchApi(source: GitlabSource, path: string, query: Record<string, string>, signal: AbortSignal): Promise<Response> {
	const response = await request(source, path, query, signal);
	if (!response.ok) throw new Error(`GitLab "${source.name}" answered ${response.status} for ${path}`);
	return response;
}

function request(source: GitlabSource, path: string, query: Record<string, string>, signal: AbortSignal): Promise<Response> {
	// A GitLab can live under a path of its own, which a URL built from a leading slash would lose.
	const url = new URL(`${source.url.replace(/\/$/, '')}/api/v4${path}`);
	url.search = new URLSearchParams(query).toString();

	return fetch(url, { headers: source.token ? { 'private-token': source.token } : {}, signal });
}
