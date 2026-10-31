import { getSettings, SettingsError } from './src/settings.ts';

try {
	getSettings();
} catch (error) {
	console.error(error instanceof SettingsError ? error.message : error);
	process.exit(1);
}

const server = './dist/server/entry.mjs';
const { startServer } = await import(server);
await startServer().done;
