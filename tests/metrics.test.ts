import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_BUCKETS, MetricsError, metricsText, parseBuckets, sourceFetch } from '../src/metrics.ts';

describe('parseBuckets', () => {
	test('defaults to 0.1, 0.5, 1, 5, 10, 30 seconds when unset or empty', () => {
		expect(parseBuckets(undefined)).toEqual([0.1, 0.5, 1, 5, 10, 30]);
		expect(parseBuckets('  ')).toEqual(DEFAULT_BUCKETS);
	});

	test('reads seconds separated by commas', () => {
		expect(parseBuckets('0.25, 2,8')).toEqual([0.25, 2, 8]);
	});

	test.each(['abc', '1,,2', '0', '-1', '5,1', '1,1', 'Infinity', '1,two'])('rejects %j', (value) => {
		expect(() => parseBuckets(value)).toThrow(MetricsError);
	});
});

describe('sourceFetch', () => {
	let server: Server | undefined;

	afterEach(async () => {
		await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
		server?.closeAllConnections();
	});

	/** A Source that answers at once, and sends its body after `bodyDelayMs`, or cuts it short. */
	async function listen(handler: (response: ServerResponse) => void) {
		server = createServer((_, response) => handler(response));
		await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
		return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	}

	async function sampleOf(series: string) {
		const line = (await metricsText()).split('\n').find((candidate) => candidate.startsWith(`${series} `));
		return line === undefined ? undefined : Number(line.slice(series.length + 1));
	}

	test('times a 2xx call until its body is read, and not only until its headers', async () => {
		const name = 'slow-body';
		const url = await listen((response) => {
			response.writeHead(200, { 'content-type': 'application/json', 'content-length': '2' });
			response.flushHeaders();
			setTimeout(() => response.end('[]'), 300);
		});

		const response = await sourceFetch({ type: 'gitlab', name }, url);
		const labels = `source="gitlab",name="${name}",method="GET",outcome="2xx"`;
		expect(await sampleOf(`vitrine_source_http_calls_total{${labels}}`)).toBeUndefined();
		expect(await response.json()).toEqual([]);

		expect(await sampleOf(`vitrine_source_http_calls_total{${labels}}`)).toBe(1);
		expect(await sampleOf(`vitrine_source_http_call_duration_seconds_sum{${labels}}`)).toBeGreaterThanOrEqual(0.29);
	});

	test('keeps status, headers and body of the answer', async () => {
		const url = await listen((response) => response.writeHead(200, { 'x-answer': 'yes' }).end('hello'));

		const response = await sourceFetch({ type: 'harbor', name: 'intact' }, url);

		expect(response.status).toBe(200);
		expect(response.headers.get('x-answer')).toBe('yes');
		expect(await response.text()).toBe('hello');
	});

	test('counts a body cut short as an error', async () => {
		const url = await listen((response) => {
			response.writeHead(200, { 'content-length': '100' });
			response.write('partial');
			setTimeout(() => response.destroy(), 50);
		});

		const response = await sourceFetch({ type: 'nexus', name: 'cut' }, url);
		await expect(response.text()).rejects.toThrow();

		expect(await sampleOf('vitrine_source_http_calls_total{source="nexus",name="cut",method="GET",outcome="error"}')).toBe(1);
		expect(await sampleOf('vitrine_source_http_calls_total{source="nexus",name="cut",method="GET",outcome="2xx"}')).toBeUndefined();
	});

	test('counts a refusal at its headers, without its body being read', async () => {
		const url = await listen((response) => response.writeHead(403).end('no'));

		await sourceFetch({ type: 'gitlab', name: 'refused' }, url);

		expect(await sampleOf('vitrine_source_http_calls_total{source="gitlab",name="refused",method="GET",outcome="4xx"}')).toBe(1);
	});
});
