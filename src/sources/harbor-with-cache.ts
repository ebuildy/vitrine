import { readThrough } from '../content-cache.ts';
import type { CachedContent } from '../content-cache.ts';
import type { HarborSource } from '../settings.ts';
import * as harbor from './harbor.ts';
import type { Image } from './harbor.ts';

export function listImages(source: HarborSource, project: string): Promise<CachedContent<Image[]>> {
	return readThrough(`${source.name}/images/${project}`, source.allowedAgeMinutes * 60_000, (signal) =>
		harbor.listImages(source, project, signal),
	);
}
