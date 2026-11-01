import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const NEEDED_TO_BUILD = ['astro.config.mjs', 'LICENSE', 'package-lock.json', 'package.json', 'start.ts', 'src/settings.ts', 'tsconfig.json'];

const PRIVATE_TO_THE_CHECKOUT = ['settings.yaml', '.env', '.env.production', 'src/settings.yaml', 'src/.env', 'src/pages/.env.local', '.git/config', '.idea/workspace.xml'];

const USELESS_AT_RUNTIME = ['settings.example.yaml', '.env.example', 'demo/settings.yaml', 'demo/content.ts', 'tests/http.test.ts', 'docs/adr/0001.md', 'README.md', 'compose.yaml', 'Dockerfile'];

const LEFT_BY_LOCAL_WORK = ['node_modules/yaml/package.json', 'src/node_modules/yaml/package.json', 'dist/server/entry.mjs', '.test-build/start.ts', '.astro/settings.mjs'];

describe('the build context of the container image', () => {
	let checkout: string;
	let context: string[];

	/** Hands a developer's checkout to the real engine and collects what a COPY in the Dockerfile would receive. */
	beforeAll(() => {
		checkout = mkdtempSync(join(tmpdir(), 'vitrine-'));
		for (const path of [...NEEDED_TO_BUILD, ...PRIVATE_TO_THE_CHECKOUT, ...USELESS_AT_RUNTIME, ...LEFT_BY_LOCAL_WORK]) {
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

	test.each(PRIVATE_TO_THE_CHECKOUT)('leaves out %s, which may hold real hostnames or secrets', (path) => {
		expect(context).not.toContain(path);
	});

	test.each(USELESS_AT_RUNTIME)('leaves out %s, which the image does not need', (path) => {
		expect(context).not.toContain(path);
	});

	test.each(LEFT_BY_LOCAL_WORK)('leaves out %s, which the build produces itself', (path) => {
		expect(context).not.toContain(path);
	});
});
