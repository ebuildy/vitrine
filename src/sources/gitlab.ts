import { readSource, SOURCE_TIMEOUT_MS } from '../content-cache.ts';
import type { CachedContent, Loader } from '../content-cache.ts';
import { findMainGroup, isAtOrBeneath } from '../router.ts';
import type { GitlabSource } from '../settings.ts';
import * as gitlabApi from './gitlab-api.ts';
import type { Commit, Contributor, DetailedMember, Epic, Group, Issue, MainGroupContent, Project, ProjectCard, Readme, Release } from './gitlab-api.ts';

export { EpicsUnavailableError } from './gitlab-api.ts';

export type CountedGroup = Group & { projectCount: number };

/** How far what a list adds to each of its items, at a request each, could be read. */
interface ListDetails {
	detailsStale?: boolean;
	detailsMissing?: boolean;
}

/** A release, with the Project it belongs to. */
export type GroupRelease = Release & { project: Pick<Project, 'name' | 'path'> };

/** The releases of a Group, and how far those of each Project could be read. */
export type GroupReleaseList = CachedContent<GroupRelease[]> & ListDetails;

/** The Main Groups of a Source, and whether some of them could not be read. */
export type MainGroupList = CachedContent<CountedGroup[]> & Pick<ListDetails, 'detailsMissing'>;

/** The list of Members, and how far their profiles could be read. */
export type MemberList = CachedContent<DetailedMember[]> & ListDetails;

export function getGroup(source: GitlabSource, path: string): Promise<CachedContent<Group | undefined>> {
	return fromMainGroup(source, path, ({ groups }) => groups.find((group) => group.path === path));
}

/** Reads a Group only if it is a Main Group, for what exists once per Main Group. */
export function getMainGroup(source: GitlabSource, path: string): Promise<CachedContent<Group | undefined>> {
	return ifMainGroup(source, path, () => getGroup(source, path));
}

export function listSubgroups(source: GitlabSource, group: string): Promise<CachedContent<CountedGroup[]>> {
	return fromMainGroup(source, group, ({ groups, projects }) =>
		groups
			.filter(({ path }) => parentOf(path) === group)
			.map((subgroup) => withProjectCount(subgroup, projects)),
	);
}

/** Lists the Main Groups of a Source, keeping those that load when others do not. */
export async function listMainGroups(source: GitlabSource): Promise<MainGroupList> {
	const lists = await Promise.all(
		source.mainGroups.map((path) => fromMainGroup(source, path, ({ groups, projects }) => groups.filter((group) => group.path === path).map((group) => withProjectCount(group, projects)))),
	);
	if (lists.every(({ error }) => error)) return lists[0];
	return { data: lists.flatMap(({ data }) => data ?? []), stale: lists.some(({ stale }) => stale), detailsMissing: lists.some(({ error }) => error) };
}

export function listProjects(source: GitlabSource, group: string): Promise<CachedContent<Project[]>> {
	return fromMainGroup(source, group, ({ projects }) => projects.filter(({ path }) => path.startsWith(`${group}/`)));
}

export function getProject(source: GitlabSource, path: string): Promise<CachedContent<Project | undefined>> {
	return fromMainGroup(source, path, ({ projects }) => projects.find((project) => project.path === path));
}

/**
 * Lists the Members of the Group, at one request per list page. Deep lists those of every Group and Project beneath the
 * Main Group, which costs a request each, cached whole per Main Group. Either list stays apart from the Group's other
 * lists, as it fails and takes time of its own. Profiles are cached per Member, as they cost a request each: a Member
 * whose profile is not read yet shows what the list gives.
 */
export async function listMembers(source: GitlabSource, group: string, deep: boolean): Promise<MemberList> {
	const list = await inMainGroup(source, group, (mainGroup) =>
		deep
			? readSource(source, `${source.name}/members/${mainGroup}`, async (signal) => {
					const content = await fromMainGroup(source, mainGroup, (mainGroupContent) => mainGroupContent);
					if (content.error) throw content.error;
					return gitlabApi.readMembers(source, content.data, signal);
				})
			: readSource(source, `${source.name}/group-members/${group}`, (signal) => gitlabApi.readMembers(source, { groups: [{ path: group }], projects: [] }, signal)),
	);
	if (list.error) return list;

	const members = list.data.filter(({ paths }) => paths.some((path) => isAtOrBeneath(path, group)));
	const profiles = await readWhileUp(members, gitlabApi.MEMBER_READS_AT_ONCE, (member) =>
		readSource(source, `${source.name}/member/${member.id}/profile`, (signal) => gitlabApi.readMemberProfile(source, member, signal)),
	);
	return {
		data: members.map((member, index) => ({ ...member, ...profiles[index]?.data })).filter((member) => !gitlabApi.isBot(member)),
		stale: list.stale,
		detailsStale: profiles.some(({ stale }) => stale),
		detailsMissing: profiles.length < members.length || profiles.some(({ error }) => error),
	};
}

/** Lists the Epics of a Main Group, cached apart from its other lists, as a GitLab without Epics must not stop browsing. */
export function listEpics(source: GitlabSource, path: string): Promise<CachedContent<Epic[] | undefined>> {
	return ifMainGroup(source, path, () => readSource(source, `${source.name}/epics/${path}`, (signal) => gitlabApi.readEpics(source, path, signal)));
}

/** Lists the Issues beneath a Group, cached whole per Main Group and apart from its other lists, as each fails and takes time of its own. */
export async function listGroupIssues(source: GitlabSource, group: string): Promise<CachedContent<Issue[]>> {
	const list = await inMainGroup(source, group, (mainGroup) => readSource(source, `${source.name}/issues/${mainGroup}`, (signal) => gitlabApi.readIssues(source, mainGroup, signal)));
	return list.error ? list : { data: list.data.filter(({ project }) => isAtOrBeneath(project, group)), stale: list.stale };
}

/**
 * Lists the releases beneath a Group, newest first, at one request per Project, cached per Project and shared with its
 * page. Only reads Projects the Main Group lists, as GitLab's releases of a Group do not tell whether they leave out archived ones.
 */
export async function listGroupReleases(source: GitlabSource, group: string): Promise<GroupReleaseList> {
	const list = await listProjects(source, group);
	if (list.error) return list;

	const releases = await readWhileUp(list.data, gitlabApi.CARDS_AT_ONCE, (project) => readReleases(source, project));
	return {
		data: releases
			.flatMap(({ data }, index) => (data ?? []).map((release) => ({ ...release, project: list.data[index] })))
			.toSorted((first, second) => second.releasedAt.localeCompare(first.releasedAt)),
		stale: list.stale,
		detailsStale: releases.some(({ stale }) => stale),
		detailsMissing: releases.length < list.data.length || releases.some(({ error }) => error),
	};
}

/** Reads cards in list order and may stop early, as readWhileUp tells. */
export function readProjectCards(source: GitlabSource, projects: Project[]): Promise<CachedContent<ProjectCard>[]> {
	return readWhileUp(projects, gitlabApi.CARDS_AT_ONCE, (project) =>
		readSource(source, `${source.name}/project/${project.path}/card`, (signal) => gitlabApi.readProjectCard(source, project, signal)),
	);
}

export function getReadme(source: GitlabSource, path: string): Promise<CachedContent<Readme | undefined>> {
	return fromProject(source, path, 'readme', (project) => (signal) => gitlabApi.readReadme(source, project, signal));
}

export function listCommits(source: GitlabSource, path: string): Promise<CachedContent<Commit[]>> {
	return fromProject(source, path, 'commits', (project) => (signal) => gitlabApi.listCommits(source, project, signal));
}

export function listIssues(source: GitlabSource, path: string): Promise<CachedContent<Issue[]>> {
	return fromProject(source, path, 'issues', (project) => (signal) => gitlabApi.listIssues(source, project, signal));
}

export function listReleases(source: GitlabSource, path: string): Promise<CachedContent<Release[]>> {
	return fromProject(source, path, 'releases', (project) => (signal) => gitlabApi.listReleases(source, project, signal));
}

function readReleases(source: GitlabSource, project: Project) {
	return readProject(source, project, 'releases', (signal) => gitlabApi.listReleases(source, project, signal));
}

export function listContributors(source: GitlabSource, path: string): Promise<CachedContent<Contributor[]>> {
	return fromProject(source, path, 'contributors', (project) => (signal) => gitlabApi.listContributors(source, project, signal));
}

/** Only reads what the Main Group lists, so that an archived Project stays out whatever its URL. */
async function fromProject<T>(source: GitlabSource, path: string, kind: string, loader: (project: Project) => Loader<T>): Promise<CachedContent<T>> {
	const project = await getProject(source, path);
	if (project.error) return project;
	if (!project.data) return { error: new Error(`"${path}" is not a Project of "${source.name}"`) };
	return readProject(source, project.data, kind, loader(project.data));
}

function readProject<T>(source: GitlabSource, { path }: Project, kind: string, loader: Loader<T>): Promise<CachedContent<T>> {
	return readSource(source, `${source.name}/project/${path}/${kind}`, loader);
}

/** Lists are cached whole per Main Group, so every page and search reads the same data. */
function fromMainGroup<T>(source: GitlabSource, path: string, pick: (content: MainGroupContent) => T): Promise<CachedContent<T>> {
	return inMainGroup(source, path, async (mainGroup) => {
		const content = await readSource(source, `${source.name}/main-group/${mainGroup}`, (signal) => gitlabApi.readMainGroup(source, mainGroup, signal));
		return content.error ? content : { data: pick(content.data), stale: content.stale };
	});
}

/** What exists once per Main Group is not there for any other Group, which is no failure. */
async function ifMainGroup<T>(source: GitlabSource, path: string, read: () => Promise<CachedContent<T>>): Promise<CachedContent<T | undefined>> {
	return source.mainGroups.includes(path) ? read() : { data: undefined, stale: false };
}

async function inMainGroup<T>(source: GitlabSource, path: string, read: (mainGroup: string) => Promise<CachedContent<T>>): Promise<CachedContent<T>> {
	const mainGroup = findMainGroup(source, path);
	return mainGroup ? read(mainGroup) : { error: new Error(`"${path}" is outside the Main Groups of "${source.name}"`) };
}

/**
 * Reads in list order and may stop early, as details must not hold a page back: past one Source timeout, or once
 * a Source fails, the rest stay unread and fill in as Visitors come back. Stale details do not stop it.
 */
async function readWhileUp<T, R>(items: T[], atOnce: number, read: (item: T) => Promise<CachedContent<R>>): Promise<CachedContent<R>[]> {
	const results: CachedContent<R>[] = [];
	const started = Date.now();
	for (let start = 0; start < items.length; start += atOnce) {
		const batch = await Promise.all(items.slice(start, start + atOnce).map(read));
		results.push(...batch);
		if (batch.some(({ error }) => error) || Date.now() - started >= SOURCE_TIMEOUT_MS) break;
	}
	return results;
}

function withProjectCount(group: Group, projects: Project[]): CountedGroup {
	return { ...group, projectCount: projects.filter(({ path }) => path.startsWith(`${group.path}/`)).length };
}

function parentOf(path: string) {
	return path.slice(0, path.lastIndexOf('/'));
}
