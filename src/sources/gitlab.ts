import { readSource } from '../content-cache.ts';
import type { CachedContent, Loader } from '../content-cache.ts';
import { findMainGroup } from '../settings.ts';
import type { GitlabSource } from '../settings.ts';
import * as gitlabApi from './gitlab-api.ts';
import type { Commit, Contributor, Group, Issue, MainGroupContent, Project, Readme, Release } from './gitlab-api.ts';

export function getGroup(source: GitlabSource, path: string): Promise<CachedContent<Group | undefined>> {
	return fromMainGroup(source, path, ({ groups }) => groups.find((group) => group.path === path));
}

export function listSubgroups(source: GitlabSource, group: string): Promise<CachedContent<Group[]>> {
	return fromMainGroup(source, group, ({ groups }) => groups.filter(({ path }) => parentOf(path) === group));
}

export function listProjects(source: GitlabSource, group: string): Promise<CachedContent<Project[]>> {
	return fromMainGroup(source, group, ({ projects }) => projects.filter(({ path }) => path.startsWith(`${group}/`)));
}

export function getProject(source: GitlabSource, path: string): Promise<CachedContent<Project | undefined>> {
	return fromMainGroup(source, path, ({ projects }) => projects.find((project) => project.path === path));
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
async function fromMainGroup<T>(source: GitlabSource, path: string, pick: (content: MainGroupContent) => T): Promise<CachedContent<T>> {
	const mainGroup = findMainGroup(source, path);
	if (!mainGroup) return { error: new Error(`"${path}" is outside the Main Groups of "${source.name}"`) };

	const content = await readSource(source, `${source.name}/main-group/${mainGroup}`, (signal) => gitlabApi.readMainGroup(source, mainGroup, signal));
	return content.error ? content : { data: pick(content.data), stale: content.stale };
}

function parentOf(path: string) {
	return path.slice(0, path.lastIndexOf('/'));
}
