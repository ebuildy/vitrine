import type { NexusSource } from '../settings.ts';

export interface Repository {
	name: string;
	/** As Nexus names it, such as maven2, npm, docker or raw. */
	format: string;
	/** hosted, proxy or group. */
	type: string;
	/** The page of the Repository in the Nexus UI. */
	webUrl: string;
}

interface NexusRepository {
	name: string;
	format: string;
	type: string;
}

const REPOSITORIES_PATH = '/service/rest/v1/repositories';

/** Every Repository the credentials can read. Nexus answers the whole list at once. */
export async function listRepositories(source: NexusSource, signal: AbortSignal): Promise<Repository[]> {
	// Relative, so that a Nexus served under a path, such as https://example.com/nexus/, keeps it.
	const response = await fetch(new URL(REPOSITORIES_PATH.slice(1), withTrailingSlash(source.url)), { headers: authHeaders(source), signal });
	if (!response.ok) throw new Error(`Nexus "${source.name}" answered ${response.status} for ${REPOSITORIES_PATH}`);
	const repositories: NexusRepository[] = await response.json();
	return repositories.map(({ name, format, type }) => ({
		name,
		format,
		type,
		webUrl: new URL(`#browse/browse:${encodeURIComponent(name)}`, withTrailingSlash(source.url)).href,
	}));
}

function withTrailingSlash(url: string) {
	return url.endsWith('/') ? url : `${url}/`;
}

function authHeaders({ username, password }: NexusSource): Record<string, string> {
	if (!username || !password) return {};
	return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
}
