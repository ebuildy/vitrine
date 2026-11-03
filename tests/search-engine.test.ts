import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { getSearchEngine } from '../src/search/search-engine.ts';
import type { SearchResult } from '../src/search/search-engine.ts';
import { startFakeGitlab } from './support/fake-gitlab.ts';
import type { FakeGitlab } from './support/fake-gitlab.ts';
import { startFakeHarbor } from './support/fake-harbor.ts';
import type { FakeHarbor } from './support/fake-harbor.ts';
import { writeSettings } from './support/vitrine.ts';

let gitlab: FakeGitlab;
let toolsGitlab: FakeGitlab;
let harbor: FakeHarbor;
/** Down from the start, so that none of its lists is ever cached. */
let brokenGitlab: FakeGitlab;

const issue = (title: string, labels: string[] = []) => ({ title, state: 'opened', confidential: false, assignees: [], labels, web_url: `http://issues.test/${title.length}` });

beforeAll(async () => {
	gitlab = await startFakeGitlab({
		groups: [
			{
				path: 'platform',
				name: 'Platform',
				description: 'Everything we run',
				members: [
					{ id: 1, name: 'Ada Lovelace', username: 'ada' },
					{ id: 2, name: 'Renovate', username: 'project_12_bot_renovate' },
				],
				epics: [{ title: 'Checkout redesign', description: 'A faster flow' }],
			},
			{ path: 'platform/backend', name: 'Backend' },
			{ path: 'nothing', epicsUnavailable: true },
		],
		projects: [
			{ path: 'platform/backend/payments', description: 'Takes money', topics: ['golang'], issues: [issue('Refund fails on Sundays', ['bug'])] },
			{ path: 'platform/backend/ledger', description: 'Keeps accounts' },
			{ path: 'platform/backend/hedger', description: 'Covers risks' },
			{ path: 'platform/backend/secret', description: 'Takes money', archived: true },
		],
	});
	toolsGitlab = await startFakeGitlab({ groups: [{ path: 'tools', name: 'Tools' }], projects: [{ path: 'tools/payments-cli', description: 'Pays from a shell' }] });
	brokenGitlab = await startFakeGitlab({ groups: [{ path: 'broken' }] });
	brokenGitlab.behave('down');
	harbor = await startFakeHarbor({
		projects: { platform: ['platform/payments'], aged: ['aged/payments'], private: ['private/payments'] },
		artifacts: { 'platform/payments': [{ size: 1, tags: [{ name: '2.4.0', push_time: '2026-10-01T08:00:00.000Z' }] }] },
	});
	process.env.VITRINE_SETTINGS = writeSettings({
		sources: [
			{ name: 'main-gitlab', type: 'gitlab', url: gitlab.url, mainGroups: ['platform', 'nothing'] },
			{ name: 'tools-gitlab', type: 'gitlab', url: toolsGitlab.url, mainGroups: ['tools'] },
			{ name: 'broken-gitlab', type: 'gitlab', url: brokenGitlab.url, mainGroups: ['broken'] },
			{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'] },
			{ name: 'aged-harbor', type: 'harbor', url: harbor.url, projects: ['aged'], allowedAgeMinutes: 5 },
		],
		routes: [{ url: '/harbor/:source/:project', controller: 'harbor-images' }],
	});
});

afterAll(async () => {
	await gitlab?.stop();
	await toolsGitlab?.stop();
	await brokenGitlab?.stop();
	await harbor?.stop();
});

afterEach(() => {
	vi.useRealTimers();
	gitlab.behave('up');
	harbor.behave('up');
});

function search(text: string, filters: { types?: SearchResult['type'][]; sources?: string[] } = {}) {
	return getSearchEngine().search({ text, ...filters });
}

/** Each result as its type, Source and title, which is what tells results apart for a Visitor. */
function found(results: SearchResult[]) {
	return results.map(({ type, source, title }) => `${type} ${source} ${title}`).sort();
}

test('one search covers Groups, Projects, Issues, Members, Epics and Images across all Sources', async () => {
	const { results } = await search('payments');

	expect(found(results)).toEqual(['image aged-harbor aged/payments', 'image main-harbor platform/payments', 'issue main-gitlab Refund fails on Sundays', 'project main-gitlab payments', 'project tools-gitlab payments-cli']);
	expect(found((await search('platform')).results)).toContain('group main-gitlab Platform');
	expect(found((await search('refund')).results)).toEqual(['issue main-gitlab Refund fails on Sundays']);
	expect(found((await search('ada')).results)).toEqual(['member main-gitlab Ada Lovelace']);
	expect(found((await search('checkout')).results)).toEqual(['epic main-gitlab Checkout redesign']);
});

test('finds only Published content', async () => {
	const titles = found((await search('takes money')).results).join('\n') + found((await search('payments')).results).join('\n') + found((await search('renovate')).results).join('\n');

	expect(titles).not.toContain('secret');
	expect(titles).not.toContain('private/payments');
	expect(titles).not.toContain('Renovate');
});

test.each([
	['a wrong letter', 'paymants'],
	['a missing letter', 'paymnts'],
	['an added letter', 'paymentss'],
	['two letters swapped', 'pyaments'],
	['a typo at the start of a word', 'leger'],
])('forgives %s', async (_, text) => {
	expect((await search(text, { types: ['project'] })).results.length).toBeGreaterThan(0);
});

test('forgives one wrong letter at most', async () => {
	expect((await search('pymants')).results).toEqual([]);
});

test('ranks a match of the whole word above a forgiven one', async () => {
	const titles = async (text: string) => (await search(text, { types: ['project'] })).results.map(({ title }) => title);

	expect(await titles('ledger')).toEqual(['ledger', 'hedger']);
	expect(await titles('hedger')).toEqual(['hedger', 'ledger']);
});

test('filters results by content type and by Source, and counts what each filter would give', async () => {
	const byType = await search('payments', { types: ['project'] });
	expect(found(byType.results)).toEqual(['project main-gitlab payments', 'project tools-gitlab payments-cli']);

	const both = await search('payments', { types: ['project', 'image'], sources: ['main-gitlab', 'main-harbor'] });
	expect(found(both.results)).toEqual(['image main-harbor platform/payments', 'project main-gitlab payments']);
	expect(both.counts.types).toEqual({ image: 1, issue: 1, project: 1 });
	expect(both.counts.sources).toEqual({ 'aged-harbor': 1, 'main-gitlab': 1, 'main-harbor': 1, 'tools-gitlab': 1 });
});

test('links each result to where its content lives', async () => {
	const links = (results: SearchResult[]) => results.map(({ type, url }) => `${type} ${url}`).sort();

	expect(links((await search('payments', { sources: ['main-gitlab'], types: ['project'] })).results)).toEqual([`project ${gitlab.url}/platform/backend/payments`]);
	expect(links((await search('backend', { types: ['group'] })).results)).toEqual([`group ${gitlab.url}/groups/platform/backend`]);
	expect(links((await search('refund')).results)).toEqual(['issue http://issues.test/23']);
	expect(links((await search('lovelace')).results)).toEqual([`member ${gitlab.url}/ada`]);
	expect(links((await search('checkout')).results)).toEqual([`epic ${gitlab.url}/groups/platform/-/work_items/1`]);
	expect(links((await search('payments', { sources: ['main-harbor'] })).results)).toEqual(['image /harbor/main-harbor/platform']);
});

const MINUTE = 60_000;

function sourceCalls() {
	return gitlab.requests.length + toolsGitlab.requests.length + harbor.requests.length;
}

test('makes no Source calls when lists are cached', async () => {
	await search('payments');
	const before = sourceCalls();

	await search('ledger');
	await search('ada', { types: ['member'], sources: ['main-gitlab'] });

	expect(sourceCalls()).toBe(before);
});

test('makes no Source calls without words to search', async () => {
	const before = sourceCalls();

	expect((await search('  - ')).results).toEqual([]);
	expect(sourceCalls()).toBe(before);
});

function imageListCalls(project: string) {
	return harbor.repositoryListRequests().filter((request) => request.includes(`/projects/${project}/`)).length;
}

test('loads a list again through the content cache once past its allowed age', async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.advanceTimersByTime(5 * MINUTE);
	await search('payments');
	const before = imageListCalls('aged');

	vi.advanceTimersByTime(5 * MINUTE - 1);
	await search('payments');
	expect(imageListCalls('aged')).toBe(before);

	vi.advanceTimersByTime(1);
	await search('payments');
	expect(imageListCalls('aged')).toBe(before + 1);
});

test('marks results from Stale lists while the Source is down', async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	await search('payments');

	vi.advanceTimersByTime(365 * 24 * 60 * MINUTE);
	harbor.behave('down');
	const { results } = await search('payments');

	const staleness = results.map(({ source, title, stale }) => `${source} ${title} ${stale}`).sort();
	expect(staleness).toEqual([
		'aged-harbor aged/payments true',
		'main-gitlab Refund fails on Sundays false',
		'main-gitlab payments false',
		'main-harbor platform/payments true',
		'tools-gitlab payments-cli false',
	]);
});

test('names the lists it could not read, and still answers from the others', async () => {
	const { results, missing } = await search('payments');

	expect(missing).toEqual([
		{ source: 'broken-gitlab', list: 'Groups and Projects of broken' },
		{ source: 'broken-gitlab', list: 'Issues of broken' },
		{ source: 'broken-gitlab', list: 'Members of broken' },
		{ source: 'broken-gitlab', list: 'Epics of broken' },
	]);
	expect(found(results)).toContain('project main-gitlab payments');
});

test('names no list of a GitLab without Epics, which has none to find', async () => {
	expect((await search('payments')).missing.map(({ list }) => list)).not.toContain('Epics of nothing');
});
