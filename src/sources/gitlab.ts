import { readSource, SOURCE_TIMEOUT_MS } from '../content-cache.ts';
import type { CachedContent, Loader } from '../content-cache.ts';
import { findMainGroup, isAtOrBeneath } from '../router.ts';
import type { GitlabSource } from '../settings.ts';
import * as gitlabApi from './gitlab-api.ts';
import type { Commit, Contributor, DetailedMember, Epic, Group, Issue, MainGroupContent, Project, ProjectCard, Readme, Release } from './gitlab-api.ts';

export { EpicsUnavailableError } from './gitlab-api.ts';

export type Subgroup = Group & { projectCount: number };

/** The list of Members, and how far their profiles could be read. */
export type MemberList = CachedContent<DetailedMember[]> & { detailsStale?: boolean; detailsMissing?: boolean };

export function getGroup(source: GitlabSource, path: string): Promise<CachedContent<Group | undefined>> {
	return fromMainGroup(source, path, ({ groups }) => groups.find((group) => group.path === path));
}

/** Reads a Group only if it is a Main Group, for what exists once per Main Group. */
export function getMainGroup(source: GitlabSource, path: string): Promise<CachedContent<Group | undefined>> {
	return ifMainGroup(source, path, () => getGroup(source, path));
}

export function listSubgroups(source: GitlabSource, group: string): Promise<CachedContent<Subgroup[]>> {
	return fromMainGroup(source, group, ({ groups, projects }) =>
		groups
			.filter(({ path }) => parentOf(path) === group)
			.map((subgroup) => ({ ...subgroup, projectCount: projects.filter(({ path }) => path.startsWith(`${subgroup.path}/`)).length })),
	);
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

export function listContributors(source: GitlabSource, path: string): Promise<CachedContent<Contributor[]>> {
	return fromProject(source, path, 'contributors', (project) => (signal) => gitlabApi.listContributors(source, project, signal));
}

/** Only reads what the Main Group lists, so that an archived Project stays out whatever its URL. */
async function fromProject<T>(source: GitlabSource, path: string, kind: string, loader: (project: Project) => Loader<T>): Promise<CachedContent<T>> {
	const project = await getProject(source, path);
	if (project.error) return project;
	if (!project.data) return { error: new Error(`"${path}" is not a Project of "${source.name}"`) };
	return readSource(source, `${source.name}/project/${path}/${kind}`, loader(project.data));
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

function parentOf(path: string) {
	return path.slice(0, path.lastIndexOf('/'));
}
