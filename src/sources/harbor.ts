import { readThrough } from '../content-cache.ts';
import type { CachedContent } from '../content-cache.ts';
import type { HarborSource } from '../settings.ts';
import * as harborApi from './harbor-api.ts';
import type { Image } from './harbor-api.ts';

export function listImages(source: HarborSource, project: string): Promise<CachedContent<Image[]>> {
	return readThrough(`${source.name}/images/${project}`, source.allowedAgeMinutes * 60_000, (signal) =>
		harborApi.listImages(source, project, signal),
	);
}
