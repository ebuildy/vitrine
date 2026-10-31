import { readThrough, readUncached } from '../content-cache.ts';
import type { CachedContent, Loader } from '../content-cache.ts';
import type { HarborSource } from '../settings.ts';
import * as harborApi from './harbor-api.ts';
import type { Image, Project } from './harbor-api.ts';

export function listImages(source: HarborSource, project: string): Promise<CachedContent<Image[]>> {
	return read(source, `${source.name}/images/${project}`, (signal) => harborApi.listImages(source, project, signal));
}

export function listProjects(source: HarborSource): Promise<CachedContent<Project[]>> {
	return read(source, `${source.name}/projects`, (signal) => harborApi.listProjects(source, signal));
}

function read<T>(source: HarborSource, key: string, loader: Loader<T>): Promise<CachedContent<T>> {
	if (source.allowedAgeMinutes === 0) {
		return readUncached(key, loader);
	} else {
		return readThrough(key, source.allowedAgeMinutes * 60_000, loader);
	}
}
