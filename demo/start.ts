import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from '../src/settings.ts';
import { withSourceUrls } from './settings.ts';
import { startDemoSources } from './sources.ts';

// Beside demo/settings.yaml, so that files it names resolve the same. Git ignores it.
// One file per run: Vitrine reads its Settings at the first request, by which time another demo in this worktree could have rewritten a shared file.
const SETTINGS = `demo/.settings-${process.pid}.yaml`;

// Each fake asks for the secret Vitrine reads, so a demo that shows content proves .env reached Vitrine.
loadEnvFile();
const { GITLAB_TOKEN, HARBOR_PASSWORD } = process.env;
if (!GITLAB_TOKEN || !HARBOR_PASSWORD) {
	console.error('The demo needs GITLAB_TOKEN and HARBOR_PASSWORD: run cp .env.example .env');
	process.exit(1);
}

// Every fake listens on a free port, so demos in several worktrees run side by side.
const { urls } = await startDemoSources({ gitlabToken: GITLAB_TOKEN, harborPassword: HARBOR_PASSWORD });
writeFileSync(SETTINGS, withSourceUrls(readFileSync('demo/settings.yaml', 'utf8'), urls));
process.on('exit', () => rmSync(SETTINGS, { force: true }));
for (const [name, url] of Object.entries(urls)) console.log(`Fake Source ${name} on ${url}`);

// Without --ignore-lock, Astro moves itself to the background under an AI agent, and the fakes would end with this process.
// Astro takes the next free port when 4321 is taken, and prints the URL it serves on.
const astro = spawn(resolve('node_modules/.bin/astro'), ['dev', '--ignore-lock'], {
	env: { ...process.env, VITRINE_SETTINGS: SETTINGS },
	stdio: ['ignore', 'inherit', 'inherit'],
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => astro.kill(signal));
astro.once('exit', (code) => process.exit(code ?? 0));
