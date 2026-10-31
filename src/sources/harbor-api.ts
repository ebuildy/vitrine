import type { HarborSource } from '../settings.ts';

const PAGE_SIZE = 100;
// A whole list must load within the Source timeout, without sending every one of its requests at once.
const REQUESTS_AT_ONCE = 10;

export interface Project {
	name: string;
	repositoryCount: number;
	createdAt: string;
	storageUsed?: number;
}

export interface Scan {
	critical: number;
	high: number;
	medium: number;
	low: number;
	scannedAt: string;
}

export interface Tag {
	name: string;
	size: number;
	pushedAt: string;
	pullReference: string;
	scan?: Scan;
}

export interface Image {
	name: string;
	tags: Tag[];
}

interface HarborProject {
	project_id: number;
	name: string;
	repo_count?: number;
	creation_time: string;
}

interface HarborProjectSummary {
	quota?: { used?: { storage?: number } };
}

interface HarborRepository {
	name: string;
}

interface HarborArtifact {
	size: number;
	tags: { name: string; push_time: string }[] | null;
	scan_overview?: Record<string, HarborScanReport> | null;
}

interface HarborScanReport {
	scan_status: string;
	end_time: string;
	summary?: { summary: Record<string, number> | null };
}

export async function listImages(source: HarborSource, project: string, signal: AbortSignal): Promise<Image[]> {
	const path = `/api/v2.0/projects/${encodeURIComponent(project)}/repositories`;
	const repositories = await fetchAllPages<HarborRepository>(source, path, {}, signal);

	return inBatches(repositories, ({ name }) => readImage(source, path, project, name, signal));
}

export async function listProjects(source: HarborSource, signal: AbortSignal): Promise<Project[]> {
	const projects = await fetchAllPages<HarborProject>(source, '/api/v2.0/projects', {}, signal);
	return inBatches(projects, async ({ project_id, name, repo_count, creation_time }) => ({
		name,
		repositoryCount: repo_count ?? 0,
		createdAt: creation_time,
		storageUsed: await fetchStorageUsed(source, project_id, signal),
	}));
}

/** Harbor keeps quotas from some readers, so a refusal only leaves the storage used unknown. */
async function fetchStorageUsed(source: HarborSource, projectId: number, signal: AbortSignal): Promise<number | undefined> {
	const path = `/api/v2.0/projects/${projectId}/summary`;
	const response = await fetch(new URL(path, source.url), { headers: authHeaders(source), signal });
	if (response.status === 401 || response.status === 403) return undefined;
	if (!response.ok) throw new Error(`Harbor "${source.name}" answered ${response.status} for ${path}`);
	const summary: HarborProjectSummary = await response.json();
	return summary.quota?.used?.storage;
}

async function inBatches<T, R>(items: T[], read: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	for (let start = 0; start < items.length; start += REQUESTS_AT_ONCE) {
		results.push(...(await Promise.all(items.slice(start, start + REQUESTS_AT_ONCE).map(read))));
	}
	return results;
}

async function readImage(source: HarborSource, repositoriesPath: string, project: string, name: string, signal: AbortSignal): Promise<Image> {
	// Harbor wants a repository name without its project, and encoded twice.
	const repository = encodeURIComponent(encodeURIComponent(name.slice(project.length + 1)));
	const artifacts = await fetchAllPages<HarborArtifact>(source, `${repositoriesPath}/${repository}/artifacts`, { with_scan_overview: 'true' }, signal);
	return {
		name,
		tags: artifacts.flatMap(({ size, tags, scan_overview }) => {
			const scan = readScan(scan_overview);
			return (tags ?? []).map((tag) => ({
				name: tag.name,
				size,
				pushedAt: tag.push_time,
				pullReference: `${new URL(source.url).host}/${name}:${tag.name}`,
				scan,
			}));
		}),
	};
}

function readScan(overview: HarborArtifact['scan_overview']): Scan | undefined {
	const report = Object.values(overview ?? {}).find(({ scan_status }) => scan_status === 'Success');
	if (!report) return undefined;
	const counts = report.summary?.summary ?? {};
	return {
		critical: counts.Critical ?? 0,
		high: counts.High ?? 0,
		medium: counts.Medium ?? 0,
		low: counts.Low ?? 0,
		scannedAt: report.end_time,
	};
}

async function fetchAllPages<T>(source: HarborSource, path: string, query: Record<string, string>, signal: AbortSignal): Promise<T[]> {
	const items: T[] = [];
	for (let page = 1; ; page++) {
		const url = new URL(path, source.url);
		url.search = new URLSearchParams({ ...query, page: String(page), page_size: String(PAGE_SIZE) }).toString();

		const response = await fetch(url, { headers: authHeaders(source), signal });
		if (!response.ok) throw new Error(`Harbor "${source.name}" answered ${response.status} for ${path}`);
		const batch: T[] = await response.json();
		items.push(...batch);
		if (batch.length < PAGE_SIZE) return items;
	}
}

function authHeaders({ username, password }: HarborSource): Record<string, string> {
	if (!username || !password) return {};
	return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
}
