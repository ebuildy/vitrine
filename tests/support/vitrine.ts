import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { stringify } from 'yaml';
import { freePort } from './free-port.ts';

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

/** Writes Settings, with `files` beside them under their relative paths, for Settings that name local files. */
export function writeSettings(settings: unknown, files: Record<string, string> = {}): string {
	const directory = mkdtempSync(join(tmpdir(), 'vitrine-'));
	const path = join(directory, 'settings.yaml');
	writeFileSync(path, typeof settings === 'string' ? settings : stringify(settings));
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(dirname(join(directory, name)), { recursive: true });
		writeFileSync(join(directory, name), content);
	}
	return path;
}

export function writeEnvFile(content: string): string {
	const path = join(mkdtempSync(join(tmpdir(), 'vitrine-')), '.env');
	writeFileSync(path, content);
	return path;
}

/** One line of Vitrine's log, which is a JSON object. */
export interface LogMessage {
	time: string;
	level: 'debug' | 'info' | 'warn' | 'error';
	msg: string;
	label?: string;
	[field: string]: unknown;
}

/** The messages in what a process printed, leaving out any line that is not a JSON object. */
export function messagesOf(output: string): LogMessage[] {
	return output.split('\n').flatMap((line) => {
		if (!line.startsWith('{')) return [];
		try {
			return [JSON.parse(line) as LogMessage];
		} catch {
			return [];
		}
	});
}

/** Everything the messages say as text, with the message and stack of an Error field, to look for a phrase in. */
export function textOf(messages: LogMessage[]): string {
	return messages
		.flatMap((message) => Object.values(message).flatMap((value) => (typeof value === 'string' ? [value] : value instanceof Object && 'message' in value ? [String(value.message), String((value as { stack?: string }).stack)] : [])))
		.join('\n');
}

export interface RunningVitrine {
	url: string;
	/** Every message logged so far. */
	messages: () => LogMessage[];
	/** What Vitrine printed on stderr, which is no message: a crash outside the logger. */
	stderr: () => string;
	/** Resolves with the exit code, or null when a signal killed the process. */
	stop: () => Promise<number | null>;
}

function spawnVitrine(command: string, args: string[], settings: unknown, env: Record<string, string | undefined>, files?: Record<string, string>) {
	return spawn(command, args, {
		cwd: BUILD_DIR,
		env: { ...process.env, VITRINE_SETTINGS: writeSettings(settings, files), ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

export async function startVitrine(settings: unknown, env: Record<string, string> = {}, files?: Record<string, string>): Promise<RunningVitrine> {
	const port = await freePort();
	return untilServing(spawnVitrine('node', ['start.ts'], settings, { ...env, HOST: '127.0.0.1', PORT: String(port) }, files), port);
}

/** Astro serves no pages in dev under the VITEST variable, which every test inherits. Run by an agent, it also swaps the logger of Vitrine for its own JSON one, so the agent variables go too. */
export async function startDevVitrine(settings: unknown, env: Record<string, string> = {}): Promise<RunningVitrine> {
	const port = await freePort();
	return untilServing(spawnVitrine(ASTRO, ['dev', '--host', '127.0.0.1', '--port', String(port), '--ignore-lock'], settings, { ...env, VITEST: undefined, AI_AGENT: undefined, CLAUDECODE: undefined }), port);
}

async function untilServing(child: ChildProcessByStdio<null, Readable, Readable>, port: number): Promise<RunningVitrine> {
	let stderr = '';
	let stdout = '';
	child.stderr.on('data', (chunk) => (stderr += chunk));
	child.stdout.on('data', (chunk) => (stdout += chunk));
	const url = `http://127.0.0.1:${port}`;

	for (let attempt = 0; attempt < 100; attempt++) {
		if (child.exitCode !== null) throw new Error(`Vitrine exited at startup:\n${stdout}${stderr}`);
		try {
			await fetch(url);
			return {
				url,
				messages: () => messagesOf(stdout),
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
	throw new Error(`Vitrine did not start:\n${stdout}${stderr}`);
}

/** Runs a command that is expected to end by itself, and returns how it ended. */
async function runToExit(command: string, args: string[], settings: unknown, env: Record<string, string>, files?: Record<string, string>) {
	const port = await freePort();
	const child = spawnVitrine(command, args, settings, { ...env, HOST: '127.0.0.1', PORT: String(port) }, files);
	let output = '';
	child.stdout.on('data', (chunk) => (output += chunk));
	child.stderr.on('data', (chunk) => (output += chunk));
	const timeout = setTimeout(() => child.kill(), 10_000);
	const exitCode = await new Promise<number | null>((resolve) => child.once('exit', resolve));
	clearTimeout(timeout);
	const messages = messagesOf(output);
	// Each problem of Settings is a message of its own.
	const problems = messages.filter(({ msg }) => msg === 'Invalid Settings').map(({ problem }) => String(problem));
	return { exitCode, output, messages, problems };
}

export function startupFailure(settings: unknown, env: Record<string, string> = {}, files?: Record<string, string>) {
	return runToExit('node', ['start.ts'], settings, env, files);
}

export function devStartupFailure(settings: unknown) {
	return runToExit(ASTRO, ['dev'], settings, {});
}

export function runBuiltEntryDirectly(settings: unknown) {
	return runToExit('node', ['dist/server/entry.mjs'], settings, {});
}
