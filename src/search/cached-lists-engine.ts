import type { CachedContent } from '../content-cache.ts';
import { harborImagesUrl } from '../router.ts';
import { getSettings } from '../settings.ts';
import type { GitlabSource, HarborSource, Settings, Source } from '../settings.ts';
import { EpicsUnavailableError, listEpics, listGroupIssues, listMemberAccounts, readMainGroupContent } from '../sources/gitlab.ts';
import { listImages } from '../sources/harbor.ts';
import { matchScore, wordsOf } from './match.ts';
import type { Field } from './match.ts';
import type { MissingList, SearchEngine, SearchOutcome, SearchResult } from './search-engine.ts';

/** A result and the text it can be found by. */
interface Document {
	result: SearchResult;
	fields: Field[];
}

interface Collected {
	documents: Document[];
	missing: MissingList[];
}

const TITLE = 2;
const DETAIL = 1;

/**
 * Searches the lists every page reads, through the content cache, as ADR 0003 decides: a list that is fresh costs the
 * Sources nothing, and one that is missing or past its allowed age loads as it would for a page.
 */
export const cachedListsEngine: SearchEngine = {
	async search({ text, types = [], sources = [] }): Promise<SearchOutcome> {
		const queryWords = wordsOf(text);
		if (queryWords.length === 0) return { results: [], counts: { types: {}, sources: {} }, missing: [] };

		const { documents, missing } = await collect(getSettings());
		const matches = documents
			.map((document) => ({ result: document.result, score: matchScore(queryWords, document.fields) }))
			.filter(({ score }) => score > 0)
			.sort((first, second) => second.score - first.score || first.result.title.localeCompare(second.result.title))
			.map(({ result }) => result);

		const ofType = ({ type }: SearchResult) => types.length === 0 || types.includes(type);
		const ofSource = ({ source }: SearchResult) => sources.length === 0 || sources.includes(source);
		return {
			results: matches.filter((result) => ofType(result) && ofSource(result)),
			counts: { types: countBy(matches.filter(ofSource), ({ type }) => type), sources: countBy(matches.filter(ofType), ({ source }) => source) },
			missing,
		};
	},
};

async function collect(settings: Settings): Promise<Collected> {
	return merge(await Promise.all(settings.sources.map((source) => (source.type === 'gitlab' ? collectGitlab(source) : collectHarbor(source, settings)))));
}

/** What every result of a Source shares. */
function foundIn(source: Source) {
	return (title: string, url: string, stale: boolean) => ({ source: source.name, sourceType: source.type, title, url, stale });
}

async function collectGitlab(source: GitlabSource): Promise<Collected> {
	const found = foundIn(source);
	const perMainGroup = await Promise.all(
		source.mainGroups.map(async (mainGroup) => {
			const [content, issues, members, epics] = await Promise.all([
				readMainGroupContent(source, mainGroup),
				listGroupIssues(source, mainGroup),
				listMemberAccounts(source, mainGroup),
				listEpics(source, mainGroup),
			]);
			return [
				fromList(source, `Groups and Projects of ${mainGroup}`, content, ({ groups, projects }, stale) => [
					...groups.map((group) => ({
						result: { ...found(group.name, group.webUrl, stale), type: 'group' as const, group },
						fields: [
							{ weight: TITLE, text: group.name },
							{ weight: DETAIL, text: `${group.path} ${group.description}` },
						],
					})),
					...projects.map((project) => ({
						result: { ...found(project.name, project.webUrl, stale), type: 'project' as const, project },
						fields: [
							{ weight: TITLE, text: project.name },
							{ weight: DETAIL, text: `${project.path} ${project.description} ${project.topics.join(' ')}` },
						],
					})),
				]),
				fromList(source, `Issues of ${mainGroup}`, issues, (list, stale) =>
					list.map((issue) => ({
						result: { ...found(issue.title, issue.webUrl, stale), type: 'issue' as const, issue },
						fields: [
							{ weight: TITLE, text: issue.title },
							{ weight: DETAIL, text: `${issue.project} ${issue.labels.join(' ')} ${issue.assignees.join(' ')}` },
						],
					})),
				),
				fromList(source, `Members of ${mainGroup}`, members, (list, stale) =>
					list.map((member) => ({
						result: { ...found(member.name, profileUrl(source, member.username), stale), type: 'member' as const, member },
						fields: [
							{ weight: TITLE, text: member.name },
							{ weight: DETAIL, text: member.username },
						],
					})),
				),
				// A GitLab without Epics has none to find, which is no failure.
				epics.error instanceof EpicsUnavailableError
					? { documents: [], missing: [] }
					: fromList(source, `Epics of ${mainGroup}`, epics, (list, stale) =>
							(list ?? []).map((epic) => ({
								result: { ...found(epic.title, epic.webUrl, stale), type: 'epic' as const, epic },
								fields: [
									{ weight: TITLE, text: epic.title },
									{ weight: DETAIL, text: epic.description ?? '' },
								],
							})),
						),
			];
		}),
	);
	return merge(withoutRepeatedMembers(perMainGroup.flat()));
}

async function collectHarbor(source: HarborSource, { routes }: Settings): Promise<Collected> {
	const found = foundIn(source);
	const lists = await Promise.all(
		source.projects.map(async (project) =>
			fromList(source, `Images of ${project}`, await listImages(source, project), (images, stale) =>
				images.map((image) => ({
					// Harbor gives no address per Image, and Vitrine's page of the Harbor project shows its tags and pull commands.
					result: { ...found(image.name, harborImagesUrl(routes, source.name, project) ?? source.url, stale), type: 'image' as const, image },
					fields: [
						{ weight: TITLE, text: image.name },
						{ weight: DETAIL, text: image.tags.map(({ name }) => name).join(' ') },
					],
				})),
			),
		),
	);
	return merge(lists);
}

function fromList<T>(source: { name: string }, list: string, content: CachedContent<T>, toDocuments: (data: T, stale: boolean) => Document[]): Collected {
	return content.error ? { documents: [], missing: [{ source: source.name, list }] } : { documents: toDocuments(content.data, content.stale), missing: [] };
}

/** A person in several Main Groups of a Source is one Member. */
function withoutRepeatedMembers(lists: Collected[]): Collected[] {
	const seen = new Set<number>();
	return lists.map(({ documents, missing }) => ({
		missing,
		documents: documents.filter(({ result }) => {
			if (result.type !== 'member') return true;
			if (seen.has(result.member.id)) return false;
			seen.add(result.member.id);
			return true;
		}),
	}));
}

function merge(lists: Collected[]): Collected {
	return { documents: lists.flatMap(({ documents }) => documents), missing: lists.flatMap(({ missing }) => missing) };
}

/** GitLab shows a person's profile at their username, beneath any path GitLab itself is installed under. */
function profileUrl({ url }: GitlabSource, username: string) {
	return new URL(encodeURIComponent(username), url.endsWith('/') ? url : `${url}/`).href;
}

function countBy(results: SearchResult[], key: (result: SearchResult) => string): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const result of results) counts[key(result)] = (counts[key(result)] ?? 0) + 1;
	return counts;
}
