import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnvFile } from '../src/settings.ts';
import { startFakeGitlab } from '../tests/support/fake-gitlab.ts';
import { startFakeHarbor } from '../tests/support/fake-harbor.ts';
import { GITLAB_PORT, gitlabContent, MAIN_HARBOR_PORT, mainHarborContent, TOOLS_HARBOR_PORT, toolsHarborContent } from './content.ts';

// Each fake asks for the secret Vitrine reads, so a demo that shows content proves .env reached Vitrine.
loadEnvFile();
const { GITLAB_TOKEN, HARBOR_PASSWORD } = process.env;
if (!GITLAB_TOKEN || !HARBOR_PASSWORD) {
	console.error('The demo needs GITLAB_TOKEN and HARBOR_PASSWORD: run cp .env.example .env');
	process.exit(1);
}

await startFakeGitlab({ ...gitlabContent, token: GITLAB_TOKEN, port: GITLAB_PORT });
await startFakeHarbor({ ...mainHarborContent, credentials: { username: 'robot$vitrine', password: HARBOR_PASSWORD }, port: MAIN_HARBOR_PORT });
await startFakeHarbor({ ...toolsHarborContent, port: TOOLS_HARBOR_PORT });

// Without --ignore-lock, Astro moves itself to the background under an AI agent, and the fakes would end with this process.
const astro = spawn(resolve('node_modules/.bin/astro'), ['dev', '--ignore-lock'], {
	env: { ...process.env, VITRINE_SETTINGS: 'demo/settings.yaml' },
	stdio: ['ignore', 'inherit', 'inherit'],
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => astro.kill(signal));
astro.once('exit', (code) => process.exit(code ?? 0));
