import { readSource } from '../content-cache.ts';
import type { CachedContent } from '../content-cache.ts';
import type { HarborSource } from '../settings.ts';
import * as harborApi from './harbor-api.ts';
import type { Image, Project } from './harbor-api.ts';

export function listImages(source: HarborSource, project: string): Promise<CachedContent<Image[]>> {
	return readSource(source, `${source.name}/images/${project}`, (signal) => harborApi.listImages(source, project, signal));
}

export function listProjects(source: HarborSource): Promise<CachedContent<Project[]>> {
	return readSource(source, `${source.name}/projects`, (signal) => harborApi.listProjects(source, signal));
}
