/**
 * Which icon stands for a technology. Pure, with no import of an .svg, so that Node (the Settings, the tests) can load
 * it. src/icons.ts turns a name into the address of its file, which only code the build bundles may do.
 */
export const ICON_NAMES = [
	'ansible', 'cplusplus', 'composer', 'dart', 'debian', 'docker', 'dotnet', 'elixir', 'gitlab', 'golang', 'gradle',
	'harbor', 'helm', 'java', 'javascript', 'kotlin', 'kubernetes', 'maven', 'mongodb', 'mysql', 'nexus', 'nginx', 'nodejs',
	'npm', 'nuget', 'php', 'pnpm', 'postgres', 'python', 'redhat', 'redis', 'ruby', 'rubygems', 'rust', 'scala', 'swift',
	'terraform', 'typescript', 'yarn',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** What an icon is looked up by. Kept apart, so that a Nexus format like go and an icon name like golang cannot collide. */
export type IconQuery = { nexusFormat: string } | { imageName: string } | { name: string };

/** The formats of a Nexus Repository that have a recognisable logo. raw, gitlfs, p2 and the rest have none. */
const NEXUS_FORMATS: Record<string, IconName> = {
	maven2: 'maven',
	npm: 'npm',
	docker: 'docker',
	pypi: 'python',
	nuget: 'nuget',
	rubygems: 'ruby',
	helm: 'helm',
	apt: 'debian',
	yum: 'redhat',
	go: 'golang',
	cargo: 'rust',
};

/** The other names of an icon, besides its own. */
const ALIASES: Record<string, IconName> = {
	go: 'golang',
	ts: 'typescript',
	js: 'javascript',
	postgresql: 'postgres',
	csharp: 'dotnet',
	cpp: 'cplusplus',
	node: 'nodejs',
};

/** The Images, by their last name, that stand for a technology. The rest are only Docker images. */
const IMAGES: Record<string, IconName> = {
	nginx: 'nginx',
	node: 'nodejs',
	mongo: 'mongodb',
	postgres: 'postgres',
	redis: 'redis',
	mysql: 'mysql',
	golang: 'golang',
	python: 'python',
	php: 'php',
	ruby: 'ruby',
	rust: 'rust',
	maven: 'maven',
	gradle: 'gradle',
	openjdk: 'java',
	'eclipse-temurin': 'java',
	debian: 'debian',
};

function lookup<Value>(table: Record<string, Value>, key: string): Value | undefined {
	return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** nginx for registry.example.com:5000/team/nginx:1.2@sha256:abc: only the last segment names the technology. */
function lastSegment(imageName: string): string {
	const segment = imageName.split('/').pop() ?? '';
	return segment.split('@')[0]!.split(':')[0]!;
}

/** The name of the icon for a technology, or nothing when none fits. An Image with no known technology is a Docker image. */
export function resolveIconName(query: IconQuery): IconName | undefined {
	if ('nexusFormat' in query) return lookup(NEXUS_FORMATS, query.nexusFormat.trim().toLowerCase());
	if ('imageName' in query) return lookup(IMAGES, lastSegment(query.imageName.trim().toLowerCase())) ?? 'docker';
	const name = query.name.trim().toLowerCase();
	return (ICON_NAMES as readonly string[]).includes(name) ? (name as IconName) : lookup(ALIASES, name);
}
