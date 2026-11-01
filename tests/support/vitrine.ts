import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { stringify } from 'yaml';

const BUILD_DIR = '.test-build';
const ASTRO = resolve('node_modules/.bin/astro');

/** Builds a throwaway copy with a fork's pages added, so they never reach the real build. */
export function buildVitrine() {
	rmSync(BUILD_DIR, { recursive: true, force: true });
	mkdirSync(BUILD_DIR);
	for (const path of ['src', 'start.ts', 'astro.config.mjs', 'tsconfig.json', 'package.json']) {
		cpSync(path, join(BUILD_DIR, path), { recursive: true });
	}
	cpSync('tests/fixtures/pages', join(BUILD_DIR, 'src/pages'), { recursive: true });
	execFileSync(ASTRO, ['build'], { cwd: BUILD_DIR, stdio: 'inherit' });
}

export function writeSettings(settings: unknown): string {
	const path = join(mkdtempSync(join(tmpdir(), 'vitrine-')), 'settings.yaml');
	writeFileSync(path, typeof settings === 'string' ? settings : stringify(settings));
	return path;
}

export function writeEnvFile(content: string): string {
	const path = join(mkdtempSync(join(tmpdir(), 'vitrine-')), '.env');
	writeFileSync(path, content);
	return path;
}

export interface RunningVitrine {
	url: string;
	/** Everything logged as an error so far. */
	stderr: () => string;
	/** Resolves with the exit code, or null when a signal killed the process. */
	stop: () => Promise<number | null>;
}

function spawnVitrine(command: string, args: string[], settings: unknown, env: Record<string, string | undefined>) {
	return spawn(command, args, {
		cwd: BUILD_DIR,
		env: { ...process.env, VITRINE_SETTINGS: writeSettings(settings), ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

export async function startVitrine(settings: unknown, env: Record<string, string> = {}): Promise<RunningVitrine> {
	const port = await freePort();
	return untilServing(spawnVitrine('node', ['start.ts'], settings, { ...env, HOST: '127.0.0.1', PORT: String(port) }), port);
}

/** Astro serves no pages in dev under the VITEST variable, which every test inherits. */
export async function startDevVitrine(settings: unknown, env: Record<string, string> = {}): Promise<RunningVitrine> {
	const port = await freePort();
	return untilServing(spawnVitrine(ASTRO, ['dev', '--host', '127.0.0.1', '--port', String(port), '--ignore-lock'], settings, { ...env, VITEST: undefined }), port);
}

async function untilServing(child: ChildProcessByStdio<null, Readable, Readable>, port: number): Promise<RunningVitrine> {
	let stderr = '';
	child.stderr.on('data', (chunk) => (stderr += chunk));
	const url = `http://127.0.0.1:${port}`;

	for (let attempt = 0; attempt < 100; attempt++) {
		if (child.exitCode !== null) throw new Error(`Vitrine exited at startup:\n${stderr}`);
		try {
			await fetch(url);
			return {
				url,
				stderr: () => stderr,
				stop: () =>
					new Promise((resolve) => {
						child.once('exit', (code) => resolve(code));
						child.kill();
					}),
			};
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	child.kill();
	throw new Error(`Vitrine did not start:\n${stderr}`);
}

/** Runs a command that is expected to end by itself, and returns how it ended. */
async function runToExit(command: string, args: string[], settings: unknown, env: Record<string, string>) {
	const port = await freePort();
	const child = spawnVitrine(command, args, settings, { ...env, HOST: '127.0.0.1', PORT: String(port) });
	let output = '';
	child.stdout.on('data', (chunk) => (output += chunk));
	child.stderr.on('data', (chunk) => (output += chunk));
	const timeout = setTimeout(() => child.kill(), 10_000);
	const exitCode = await new Promise<number | null>((resolve) => child.once('exit', resolve));
	clearTimeout(timeout);
	return { exitCode, output };
}

export function startupFailure(settings: unknown, env: Record<string, string> = {}) {
	return runToExit('node', ['start.ts'], settings, env);
}

export function devStartupFailure(settings: unknown) {
	return runToExit(ASTRO, ['dev'], settings, {});
}

export function runBuiltEntryDirectly(settings: unknown) {
	return runToExit('node', ['dist/server/entry.mjs'], settings, {});
}

async function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			server.close(() => resolve(port));
		});
	});
}
