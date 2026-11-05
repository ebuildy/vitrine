import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { checkLogLevel, logger } from './src/logger.mjs';
import { fixedUrls } from './src/router.ts';
import { getSettings, loadEnvFile, prepareSettings, SettingsError } from './src/settings.ts';
import { scheduleWarmUps } from './src/warm-up.ts';

// A LOG_LEVEL kept in the env file applies from the first message.
loadEnvFile();
try {
	checkLogLevel();
} catch (error) {
	// Not through the logger, which cannot tell what to keep.
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}

// Before Settings, so that a log of a failed start still says which Vitrine it was.
logger.info('Starting Vitrine', { version: process.env.VITRINE_VERSION ?? 'dev' });

try {
	prepareSettings();
} catch (error) {
	if (error instanceof SettingsError) {
		for (const problem of error.problems) logger.error('Invalid Settings', { path: error.path, problem });
	} else {
		logger.error('Could not start', { error });
	}
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

const { warmUp, routes, navigation } = getSettings();
let stopWarmUps = () => {};
if (warmUp.atStart || warmUp.everyMinutes !== undefined) {
	if (!http.server.listening) await once(http.server, 'listening');
	// The warm-up crawls this server itself, through the address it listens on.
	const { address, family, port } = http.server.address() as AddressInfo;
	const host = address === '0.0.0.0' ? '127.0.0.1' : address === '::' ? '[::1]' : family === 'IPv6' ? `[${address}]` : address;
	const protocol = process.env.SERVER_CERT_PATH ? 'https' : 'http';
	const startPaths = [...fixedUrls(routes), ...navigation.map(({ url }) => url)];
	stopWarmUps = scheduleWarmUps(`${protocol}://${host}:${port}`, warmUp, startPaths);
}

// The adapter's own server.stop() cuts open connections, so this closes the Node server, which lets requests finish.
stop = () => {
	stopWarmUps();
	setTimeout(() => process.exit(0), DRAIN_MILLISECONDS);
	http.server.close();
};

await done;
// An open Redis connection would keep the process alive.
process.exit(0);
