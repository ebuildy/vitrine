import { getSettings, loadEnvFile, SettingsError } from './src/settings.ts';

try {
	loadEnvFile();
	getSettings();
} catch (error) {
	console.error(error instanceof SettingsError ? error.message : error);
	process.exit(1);
}

// As PID 1 in a container, Node ignores these signals unless told what to do with them.
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => process.exit(0));

const server = './dist/server/entry.mjs';
const { startServer } = await import(server);
await startServer().done;
