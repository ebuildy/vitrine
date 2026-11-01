import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const NEEDED_TO_BUILD = ['astro.config.mjs', 'LICENSE', 'package-lock.json', 'package.json', 'start.ts', 'src/settings.ts', 'tsconfig.json'];

const LEFT_OUT = [
	['settings.yaml', 'may hold real hostnames or secrets'],
	['.env', 'may hold real hostnames or secrets'],
	['.env.production', 'may hold real hostnames or secrets'],
	['src/settings.yaml', 'may hold real hostnames or secrets'],
	['src/.env', 'may hold real hostnames or secrets'],
	['src/pages/.env.local', 'may hold real hostnames or secrets'],
	['.git/config', 'may hold real hostnames or secrets'],
	['.idea/workspace.xml', 'may hold real hostnames or secrets'],
	['settings.example.yaml', 'the image does not need'],
	['.env.example', 'the image does not need'],
	['demo/settings.yaml', 'the image does not need'],
	['demo/content.ts', 'the image does not need'],
	['tests/http.test.ts', 'the image does not need'],
	['docs/adr/0001.md', 'the image does not need'],
	['README.md', 'the image does not need'],
	['compose.yaml', 'the image does not need'],
	['Containerfile', 'the image does not need'],
	['node_modules/yaml/package.json', 'the build produces itself'],
	['src/node_modules/yaml/package.json', 'the build produces itself'],
	['dist/server/entry.mjs', 'the build produces itself'],
	['.test-build/start.ts', 'the build produces itself'],
	['.astro/settings.mjs', 'the build produces itself'],
];

describe('the build context of the container image', () => {
	let checkout: string;
	let context: string[];

	/** Hands a developer's checkout to the real engine and collects what a COPY in the Containerfile would receive. */
	beforeAll(() => {
		checkout = mkdtempSync(join(tmpdir(), 'vitrine-'));
		for (const path of [...NEEDED_TO_BUILD, ...LEFT_OUT.map(([path]) => path)]) {
			mkdirSync(dirname(join(checkout, path)), { recursive: true });
			writeFileSync(join(checkout, path), 'planted by the test');
		}
		cpSync('.dockerignore', join(checkout, '.dockerignore'));

		const received = join(checkout, '.received');
		execFileSync('docker', ['build', '--quiet', '--output', `type=local,dest=${received}`, '--file', '-', checkout], {
			input: 'FROM scratch\nCOPY . /\n',
			stdio: ['pipe', 'ignore', 'inherit'],
		});
		context = readdirSync(received, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => join(entry.parentPath, entry.name).slice(received.length + 1));
	});

	afterAll(() => {
		rmSync(checkout, { recursive: true, force: true });
	});

	test('holds what the image is built from', () => {
		expect(context).toEqual(expect.arrayContaining(NEEDED_TO_BUILD));
	});

	test.each(LEFT_OUT)('leaves out %s, which %s', (path) => {
		expect(context).not.toContain(path);
	});
});
