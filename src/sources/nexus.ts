import { readSource } from '../content-cache.ts';
import type { CachedContent } from '../content-cache.ts';
import type { NexusSource } from '../settings.ts';
import * as nexusApi from './nexus-api.ts';
import type { Repository } from './nexus-api.ts';

/** The Published Repositories of a Source. The cache keeps the whole list, so that changing the selection in Settings needs no reload. */
export async function listRepositories(source: NexusSource): Promise<CachedContent<Repository[]>> {
	const content = await readSource(source, `${source.name}/repositories`, (signal) => nexusApi.listRepositories(source, signal));
	const { repositories: selected } = source;
	if (!content.data || !selected) return content;
	return { ...content, data: content.data.filter(({ name }) => selected.includes(name)) };
}
