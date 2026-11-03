import type { Source } from '../settings.ts';
import type { Epic, Group, Issue, Member, Project } from '../sources/gitlab-api.ts';
import type { Image } from '../sources/harbor-api.ts';
import { cachedListsEngine } from './cached-lists-engine.ts';

/**
 * The port every search goes through: a Controller asks a SearchEngine and never knows how it finds results.
 * ADR 0003 makes cached lists the way, and another adapter, such as one asking the Sources, would only replace
 * what getSearchEngine returns.
 */
export interface SearchEngine {
	search(query: SearchQuery): Promise<SearchOutcome>;
}

/** The kinds of content one search covers, in the order a Visitor sees them. */
export const CONTENT_TYPES = ['group', 'project', 'issue', 'member', 'epic', 'image'] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export interface SearchQuery {
	text: string;
	/** Keeps results of these types only. Empty or left out keeps every type. */
	types?: ContentType[];
	/** Keeps results of these Sources only, by name. Empty or left out keeps every Source. */
	sources?: string[];
}

interface FoundContent {
	source: string;
	sourceType: Source['type'];
	/** The address of the Source, for its own icon. */
	sourceUrl: string;
	title: string;
	/** Where the content lives. */
	url: string;
	/** Whether the content comes from a Stale list. */
	stale: boolean;
}

export type SearchResult = FoundContent &
	(
		| { type: 'group'; group: Group }
		| { type: 'project'; project: Project }
		| { type: 'issue'; issue: Issue }
		| { type: 'member'; member: Member }
		| { type: 'epic'; epic: Epic }
		| { type: 'image'; image: Image }
	);

/** A list that could not be read, so that its content is missing from results. */
export interface MissingList {
	source: string;
	list: string;
}

export interface SearchOutcome {
	/** What matches the text and the filters, best first. */
	results: SearchResult[];
	/** The matches of each type under the Source filter, and of each Source under the type filter, so a Visitor sees what a filter would give. */
	counts: { types: Partial<Record<ContentType, number>>; sources: Record<string, number> };
	missing: MissingList[];
}

export function getSearchEngine(): SearchEngine {
	return cachedListsEngine;
}
