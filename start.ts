import { getSettings, loadEnvFile, SettingsError } from './src/settings.ts';

try {
	loadEnvFile();
	getSettings();
} catch (error) {
	console.error(error instanceof SettingsError ? error.message : error);
	process.exit(1);
}

// Well under the 10 seconds Docker waits before SIGKILL.
const DRAIN_MILLISECONDS = 5_000;

let stop: () => void = () => process.exit(0);

// As PID 1 in a container, Node ignores these signals unless told what to do with them.
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => stop());

const server = './dist/server/entry.mjs';
const { startServer } = await import(server);
const { server: http, done } = startServer();

// The adapter's own server.stop() cuts open connections, so this closes the Node server, which lets requests finish.
stop = () => {
	setTimeout(() => process.exit(0), DRAIN_MILLISECONDS);
	http.server.close();
};

await done;
// An open Redis connection would keep the process alive.
process.exit(0);
