import { describe, expect, test } from 'vitest';
import { DEFAULT_BUCKETS, MetricsError, parseBuckets } from '../src/metrics.ts';

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
