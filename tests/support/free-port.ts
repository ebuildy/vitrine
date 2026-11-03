import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

/** A port nothing listens on right now, for a server that needs its URL before it starts. */
export async function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			server.close(() => resolve(port));
		});
	});
}
