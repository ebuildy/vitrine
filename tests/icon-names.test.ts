import { readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ICON_NAMES, resolveIconName } from '../src/icon-names.ts';

describe('resolveIconName from a Nexus format', () => {
	test.each([
		['maven2', 'maven'],
		['npm', 'npm'],
		['docker', 'docker'],
		['pypi', 'python'],
		['nuget', 'nuget'],
		['rubygems', 'ruby'],
		['helm', 'helm'],
		['apt', 'debian'],
		['yum', 'redhat'],
		['go', 'golang'],
		['cargo', 'rust'],
		['  Maven2 ', 'maven'],
		['NPM', 'npm'],
	])('maps %j to %s', (nexusFormat, expected) => {
		expect(resolveIconName({ nexusFormat })).toBe(expected);
	});

	test.each(['raw', 'gitlfs', 'p2', 'conan', '', '   ', 'unheard-of'])('gives no icon to %j', (nexusFormat) => {
		expect(resolveIconName({ nexusFormat })).toBeUndefined();
	});

	test('does not fall back to the Docker icon, nor read a format as an icon name', () => {
		expect(resolveIconName({ nexusFormat: 'unheard-of' })).toBeUndefined();
		// "rust" is an icon, but no Nexus format.
		expect(resolveIconName({ nexusFormat: 'rust' })).toBeUndefined();
	});
});

describe('resolveIconName from an Image name', () => {
	test.each([
		['nginx', 'nginx'],
		['library/nginx', 'nginx'],
		['Library/NGINX', 'nginx'],
		['registry.example.com/team/nginx:1.2', 'nginx'],
		['registry.example.com:5000/team/nginx', 'nginx'],
		['nginx@sha256:0123abcd', 'nginx'],
		['team/nginx:1.2@sha256:0123abcd', 'nginx'],
		['node', 'nodejs'],
		['mongo', 'mongodb'],
		['postgres', 'postgres'],
		['golang', 'golang'],
		['eclipse-temurin', 'java'],
		['openjdk', 'java'],
		['maven', 'maven'],
		['python', 'python'],
	])('maps %j to %s', (imageName, expected) => {
		expect(resolveIconName({ imageName })).toBe(expected);
	});

	test.each(['my-node-tools', 'api', 'platform/api', 'node-exporter', '', '   ', '/', 'nginx/'])(
		'falls back to the Docker icon for %j, which matches no tech by its last segment',
		(imageName) => {
			expect(resolveIconName({ imageName })).toBe('docker');
		},
	);
});

describe('resolveIconName from an icon name', () => {
	test.each(ICON_NAMES)('knows %s', (name) => {
		expect(resolveIconName({ name })).toBe(name);
	});

	test.each([
		['go', 'golang'],
		['ts', 'typescript'],
		['js', 'javascript'],
		['postgresql', 'postgres'],
		['csharp', 'dotnet'],
		['cpp', 'cplusplus'],
		['node', 'nodejs'],
		[' Maven ', 'maven'],
		['GitLab', 'gitlab'],
	])('maps the alias %j to %s', (name, expected) => {
		expect(resolveIconName({ name })).toBe(expected);
	});

	test.each(['cobol', '', 'maven2', 'constructor', '__proto__', 'toString'])('gives no icon to %j, with no fallback', (name) => {
		expect(resolveIconName({ name })).toBeUndefined();
	});
});

test('has an SVG file for every icon name, and an icon name for every SVG file', () => {
	const files = readdirSync(new URL('../src/icons', import.meta.url))
		.filter((file) => file.endsWith('.svg'))
		.map((file) => file.slice(0, -'.svg'.length))
		.sort();

	expect(files).toEqual([...ICON_NAMES].sort());
});
