import type { HarborSource } from '../settings.ts';

const PAGE_SIZE = 100;

export interface Image {
	name: string;
}

export async function listImages(source: HarborSource, project: string, signal: AbortSignal): Promise<Image[]> {
	const images: Image[] = [];
	for (let page = 1; ; page++) {
		const batch = await fetchRepositories(source, project, page, signal);
		images.push(...batch.map(({ name }) => ({ name })));
		if (batch.length < PAGE_SIZE) return images;
	}
}

async function fetchRepositories(
	source: HarborSource,
	project: string,
	page: number,
	signal: AbortSignal,
): Promise<{ name: string }[]> {
	const url = new URL(`/api/v2.0/projects/${encodeURIComponent(project)}/repositories`, source.url);
	url.searchParams.set('page', String(page));
	url.searchParams.set('page_size', String(PAGE_SIZE));

	const response = await fetch(url, { headers: authHeaders(source), signal });
	if (!response.ok) throw new Error(`Harbor "${source.name}" answered ${response.status} for project "${project}"`);
	return response.json();
}

function authHeaders({ username, password }: HarborSource): Record<string, string> {
	if (!username || !password) return {};
	return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
}
