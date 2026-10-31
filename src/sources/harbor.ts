import { readThrough, readUncached } from '../content-cache.ts';
import type { CachedContent } from '../content-cache.ts';
import type { HarborSource } from '../settings.ts';
import * as harborApi from './harbor-api.ts';
import type { Image } from './harbor-api.ts';

export function listImages(source: HarborSource, project: string): Promise<CachedContent<Image[]>> {
	const key = `${source.name}/images/${project}`;
	const loader = (signal: AbortSignal) => harborApi.listImages(source, project, signal);
	if (source.allowedAgeMinutes === 0) {
		return readUncached(key, loader);
	} else {
		return readThrough(key, source.allowedAgeMinutes * 60_000, loader);
	}
}
