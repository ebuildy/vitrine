import type { FakeGitlabMember, FakeGitlabOptions, FakeGitlabProject } from '../tests/support/fake-gitlab.ts';
import type { FakeArtifact, FakeHarborOptions } from '../tests/support/fake-harbor.ts';

export const GITLAB_PORT = 4401;
export const MAIN_HARBOR_PORT = 4402;
export const TOOLS_HARBOR_PORT = 4403;

const GITLAB_URL = `http://127.0.0.1:${GITLAB_PORT}`;
const REPORT_TYPE = 'application/vnd.security.vulnerability.report; version=1.1';
const MEGABYTE = 1_048_576;

/** Initials on a coloured disc, so the demo needs no network for its pictures. */
function avatar(name: string, hue: number) {
	const initials = name.split(' ').map((word) => word[0]).join('');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="hsl(${hue} 60% 45%)"/><text x="20" y="26" font-family="sans-serif" font-size="16" fill="white" text-anchor="middle">${initials}</text></svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const ada: FakeGitlabMember = { id: 1, name: 'Ada Lovelace', avatar_url: avatar('Ada Lovelace', 280), location: 'London', public_email: 'ada@example.com' };
const grace: FakeGitlabMember = { id: 2, name: 'Grace Hopper', avatar_url: avatar('Grace Hopper', 200), location: 'New York' };
const linus: FakeGitlabMember = { id: 3, name: 'Linus Pauling', avatar_url: avatar('Linus Pauling', 30), public_email: 'linus@example.com' };
const margaret: FakeGitlabMember = { id: 4, name: 'Margaret Hamilton', location: 'Boston', public_email: 'margaret@example.com' };
const alan: FakeGitlabMember = { id: 5, name: 'Alan Turing', avatar_url: avatar('Alan Turing', 120), location: 'Manchester' };
const edsger: FakeGitlabMember = { id: 6, name: 'Edsger Dijkstra', avatar_url: avatar('Edsger Dijkstra', 340) };
// Both left out of the Members list: one is not a person, the other no longer works here.
const renovate: FakeGitlabMember = { id: 7, name: 'Renovate', username: 'project_12_bot_renovate', bot: true };
const blocked: FakeGitlabMember = { id: 8, name: 'Former Colleague', state: 'blocked' };

const commit = (project: string, title: string, author_name: string, committed_date: string) => ({
	title,
	author_name,
	committed_date,
	web_url: `${GITLAB_URL}/${project}/-/commit/${title.length}`,
});

const issue = (project: string, iid: number, title: string, assignees: string[], labels: string[], confidential = false) => ({
	title,
	state: 'opened',
	confidential,
	assignees: assignees.map((name) => ({ name })),
	labels,
	web_url: `${GITLAB_URL}/${project}/-/issues/${iid}`,
});

const release = (project: string, name: string, tag_name: string, released_at: string) => ({
	name,
	tag_name,
	released_at,
	_links: { self: `${GITLAB_URL}/${project}/-/releases/${tag_name}` },
});

const API_README = `# Payments API

The public API behind checkout. **Every** service that takes money goes through it.

## Getting started

\`\`\`sh
docker run -p 8080:8080 harbor.example.com/platform/api:2.4.0
curl localhost:8080/healthz
\`\`\`

## Guarantees

- Requests are idempotent
- Responses stay under 200 ms at the 99th percentile

| Environment | URL |
| :---------- | :-- |
| Staging | https://api.staging.example.com |
| Production | https://api.example.com |

See [the runbook](docs/runbook.md) before changing anything on call.

<script>alert('sanitized away')</script>
`;

const api: FakeGitlabProject = {
	path: 'platform/backend/api',
	description: 'The public API behind checkout',
	last_activity_at: '2026-10-30T16:20:00.000Z',
	topics: ['golang', 'payments', 'public-api'],
	commit_count: 1234,
	readme: API_README,
	commits: [
		commit('platform/backend/api', 'Retry webhooks with backoff', 'Ada Lovelace', '2026-10-30T16:20:00.000Z'),
		commit('platform/backend/api', 'Reject expired cards before capture', 'Grace Hopper', '2026-10-28T10:05:00.000Z'),
		commit('platform/backend/api', 'Bump Go to 1.26', 'Renovate', '2026-10-27T03:00:00.000Z'),
		commit('platform/backend/api', 'Document idempotency keys', 'Ada Lovelace', '2026-10-21T14:45:00.000Z'),
	],
	issues: [
		issue('platform/backend/api', 42, 'Refunds time out above 500 line items', ['Grace Hopper'], ['bug', 'priority::high']),
		issue('platform/backend/api', 41, 'Publish an OpenAPI description', ['Ada Lovelace', 'Alan Turing'], ['documentation']),
		issue('platform/backend/api', 40, 'Support partial captures', [], ['feature']),
		// Held back by Vitrine, like anything not Published.
		issue('platform/backend/api', 39, 'Rotate the leaked signing key', ['Ada Lovelace'], ['security'], true),
	],
	releases: [
		release('platform/backend/api', 'Autumn release', 'v2.4.0', '2026-10-01T08:00:00.000Z'),
		release('platform/backend/api', 'Summer release', 'v2.3.0', '2026-07-02T08:00:00.000Z'),
		release('platform/backend/api', 'Spring release', 'v2.2.0', '2026-03-20T08:00:00.000Z'),
	],
	contributors: [
		{ name: 'Ada Lovelace', email: 'ada@example.com', commits: 612 },
		{ name: 'Grace Hopper', email: 'grace@example.com', commits: 401 },
		{ name: 'Alan Turing', email: 'alan@example.com', commits: 158 },
		{ name: 'Renovate', email: 'renovate@example.com', commits: 63 },
	],
	members: [renovate],
};

export const gitlabContent: Omit<FakeGitlabOptions, 'token' | 'port'> = {
	groups: [
		{ path: 'platform', name: 'Platform', description: 'Everything the platform team runs', members: [ada, grace, blocked] },
		{ path: 'platform/backend', name: 'Backend', description: 'Services behind the public API', members: [alan] },
		{ path: 'platform/backend/billing', name: 'Billing', description: 'Invoices and payouts', members: [edsger] },
		{ path: 'platform/frontend', name: 'Frontend', description: 'What customers see', notMember: true, members: [linus] },
		{ path: 'data', name: 'Data' },
		{ path: 'data/analytics', name: 'Analytics', description: 'Dashboards and pipelines', members: [margaret], invitedGroups: ['platform/frontend'] },
	],
	projects: [
		api,
		{
			path: 'platform/backend/worker',
			description: 'Runs the jobs the API queues',
			last_activity_at: '2026-10-22T09:00:00.000Z',
			topics: ['golang'],
			commit_count: 387,
			readme: '# Worker\n\nA project with a short README and no releases.\n',
			commits: [commit('platform/backend/worker', 'Drain the queue on shutdown', 'Alan Turing', '2026-10-22T09:00:00.000Z')],
			contributors: [{ name: 'Alan Turing', email: 'alan@example.com', commits: 387 }],
		},
		{
			path: 'platform/backend/billing/invoices',
			description: 'Turns usage into invoices',
			last_activity_at: '2026-09-14T11:30:00.000Z',
			topics: ['python', 'payments'],
			commit_count: 91,
			readme: '# Invoices\n\nThree Groups deep, to exercise nested URLs.\n',
			commits: [commit('platform/backend/billing/invoices', 'Round VAT per line', 'Edsger Dijkstra', '2026-09-14T11:30:00.000Z')],
			releases: [release('platform/backend/billing/invoices', 'First invoices', 'v1.0.0', '2026-09-01T08:00:00.000Z')],
			contributors: [{ name: 'Edsger Dijkstra', email: 'edsger@example.com', commits: 91 }],
		},
		{
			path: 'platform/frontend/storefront',
			description: 'The shop itself',
			last_activity_at: '2026-10-29T17:00:00.000Z',
			topics: ['typescript', 'astro'],
			// Left out of commit_count: GitLab keeps statistics from readers below the Reporter role.
			readme: '# Storefront\n\nThe card of this Project has no commit count.\n',
			commits: [commit('platform/frontend/storefront', 'Lazy-load the basket', 'Linus Pauling', '2026-10-29T17:00:00.000Z')],
			contributors: [{ name: 'Linus Pauling', email: 'linus@example.com', commits: 240 }],
			members: [linus],
		},
		{ path: 'platform/backend/scratchpad', description: 'A Project nobody pushed to yet', empty_repo: true, last_activity_at: '2026-08-02T08:00:00.000Z' },
		{ path: 'platform/backend/legacy-monolith', description: 'Archived, so Vitrine leaves it out', archived: true },
		{
			path: 'data/analytics/dashboards',
			description: 'Numbers people ask for on Mondays',
			last_activity_at: '2026-10-19T08:15:00.000Z',
			topics: ['sql'],
			commit_count: 54,
			readme: '# Dashboards\n\nReached through the second Main Group.\n',
			commits: [commit('data/analytics/dashboards', 'Add weekly revenue', 'Margaret Hamilton', '2026-10-19T08:15:00.000Z')],
			issues: [issue('data/analytics/dashboards', 7, 'Revenue double counts refunds', ['Margaret Hamilton'], ['bug'])],
			contributors: [{ name: 'Margaret Hamilton', email: 'margaret@example.com', commits: 54 }],
		},
	],
	avatars: {
		'ada@example.com': avatar('Ada Lovelace', 280),
		'grace@example.com': avatar('Grace Hopper', 200),
		'alan@example.com': avatar('Alan Turing', 120),
		'linus@example.com': avatar('Linus Pauling', 30),
		'edsger@example.com': avatar('Edsger Dijkstra', 340),
	},
};

const tag = (name: string, push_time: string) => ({ name, push_time });

const scanned = (end_time: string, counts: Record<string, number>) => ({
	[REPORT_TYPE]: { scan_status: 'Success', end_time, summary: { summary: counts } },
});

const artifact = (megabytes: number, push_time: string, tags: FakeArtifact['tags'], scan_overview?: FakeArtifact['scan_overview']): FakeArtifact => ({
	size: megabytes * MEGABYTE,
	push_time,
	tags,
	scan_overview,
});

export const mainHarborContent: Omit<FakeHarborOptions, 'credentials' | 'port'> = {
	projects: {
		platform: ['platform/api', 'platform/worker', 'platform/base/alpine'],
		library: ['library/nginx'],
		// Not selected in demo/settings.yaml: only the harbor Controller lists it.
		sandbox: [],
	},
	artifacts: {
		'platform/api': [
			artifact(84, '2026-10-01T08:00:00.000Z', [tag('2.4.0', '2026-10-01T08:00:00.000Z'), tag('latest', '2026-10-01T08:05:00.000Z')], scanned('2026-10-01T09:00:00.000Z', { High: 1, Medium: 3, Low: 12 })),
			artifact(82, '2026-07-02T08:00:00.000Z', [tag('2.3.0', '2026-07-02T08:00:00.000Z')], scanned('2026-07-02T09:00:00.000Z', { Critical: 2, High: 5, Medium: 9, Low: 20 })),
			// Never scanned.
			artifact(79, '2026-03-20T08:00:00.000Z', [tag('2.2.0', '2026-03-20T08:00:00.000Z')]),
			// No tags, so nothing to show.
			artifact(78, '2026-03-01T08:00:00.000Z', null),
		],
		'platform/worker': [
			artifact(1540, '2026-10-22T09:00:00.000Z', [tag('1.9.1', '2026-10-22T09:00:00.000Z')], scanned('2026-10-22T10:00:00.000Z', {})),
			artifact(1490, '2026-09-10T09:00:00.000Z', [tag('1.9.0', '2026-09-10T09:00:00.000Z')], { [REPORT_TYPE]: { scan_status: 'Error', end_time: '2026-09-10T10:00:00.000Z' } }),
		],
		'platform/base/alpine': [artifact(8, '2026-08-15T08:00:00.000Z', [tag('3.22', '2026-08-15T08:00:00.000Z')], scanned('2026-08-15T09:00:00.000Z', { Low: 1 }))],
		'library/nginx': [artifact(62, '2026-09-30T08:00:00.000Z', [tag('1.29', '2026-09-30T08:00:00.000Z'), tag('stable', '2026-09-30T08:00:00.000Z')], scanned('2026-09-30T09:00:00.000Z', { Medium: 2 }))],
	},
	projectDetails: {
		platform: { creation_time: '2024-02-12T08:00:00.000Z', repo_count: 3, summary: { quota: { used: { storage: 12_400 * MEGABYTE } } } },
		library: { creation_time: '2023-11-03T08:00:00.000Z', repo_count: 1, summary: { quota: { used: { storage: 610 * MEGABYTE } } } },
		// No summary: Harbor refuses it to this reader, so the storage used is unknown.
		sandbox: { creation_time: '2026-10-05T08:00:00.000Z', repo_count: 0 },
	},
};

export const toolsHarborContent: Omit<FakeHarborOptions, 'credentials' | 'port'> = {
	projects: { tools: ['tools/cli', 'tools/ci-runner'] },
	artifacts: {
		'tools/cli': [artifact(24, '2026-10-12T08:00:00.000Z', [tag('0.8.0', '2026-10-12T08:00:00.000Z'), tag('latest', '2026-10-12T08:00:00.000Z')], scanned('2026-10-12T09:00:00.000Z', {}))],
		'tools/ci-runner': [artifact(430, '2026-10-02T08:00:00.000Z', [tag('17.5', '2026-10-02T08:00:00.000Z')], scanned('2026-10-02T09:00:00.000Z', { High: 2, Low: 4 }))],
	},
	projectDetails: { tools: { creation_time: '2025-05-20T08:00:00.000Z', repo_count: 2, summary: { quota: { used: { storage: 1_900 * MEGABYTE } } } } },
};
