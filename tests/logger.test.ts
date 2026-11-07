import { describe, expect, it } from 'vitest';
import { checkLogLevel, createLogger, astroDestination } from '../src/logger.mjs';

function capture(env: Record<string, string | undefined> = {}) {
	const lines: string[] = [];
	const logger = createLogger({ env, write: (line: string) => lines.push(line) });
	return { logger, lines, records: () => lines.map((line) => JSON.parse(line)) };
}

describe('the logger', () => {
	it('writes one JSON line per message, with time, level, msg and the extra fields', () => {
		const { logger, lines, records } = capture();

		logger.info('Cache refilled', { key: 'gitlab/projects', count: 3 });

		expect(lines).toHaveLength(1);
		expect(lines[0]).not.toContain('\n');
		const [record] = records();
		expect(record).toEqual({ time: expect.any(String), level: 'info', msg: 'Cache refilled', key: 'gitlab/projects', count: 3 });
		expect(new Date(record.time).toISOString()).toBe(record.time);
	});

	function logOneOfEach(logger: ReturnType<typeof createLogger>) {
		logger.debug('d');
		logger.info('i');
		logger.warn('w');
		logger.error('e');
	}

	it.each([
		['debug', ['d', 'i', 'w', 'e']],
		['info', ['i', 'w', 'e']],
		['warn', ['w', 'e']],
		['error', ['e']],
		['silent', []],
		[undefined, ['i', 'w', 'e']],
		['', ['i', 'w', 'e']],
	])('keeps the messages at LOG_LEVEL=%j or above', (level, expected) => {
		const { logger, records } = capture({ LOG_LEVEL: level });

		logOneOfEach(logger);

		expect(records().map(({ msg }) => msg)).toEqual(expected);
	});

	it('never lets an extra field replace time, level or msg', () => {
		const { logger, records } = capture();

		logger.warn('Real message', { level: 'debug', msg: 'forged', time: 'never' });

		expect(records()[0]).toEqual({ time: expect.stringMatching(/^\d{4}-/), level: 'warn', msg: 'Real message' });
	});

	it('stops on a wrong LOG_LEVEL with a message that lists the valid levels', () => {
		expect(() => checkLogLevel({ LOG_LEVEL: 'loud' })).toThrow('LOG_LEVEL "loud" is not valid, use debug, info, warn, error or silent');
		expect(() => checkLogLevel({ LOG_LEVEL: 'warn' })).not.toThrow();
		expect(() => checkLogLevel({})).not.toThrow();
		expect(() => checkLogLevel({ LOG_LEVEL: '' })).not.toThrow();
	});

	it('turns an Error field into its message and stack', () => {
		const { logger, records } = capture();
		const error = new Error('boom');

		logger.error('Could not load', { key: 'a', error });

		expect(records()[0]).toMatchObject({ msg: 'Could not load', key: 'a', error: { message: 'boom', stack: error.stack } });
	});
});

describe('the Astro destination', () => {
	function astro(level: string, message: string, label: string | null, env: Record<string, string> = {}) {
		const lines: string[] = [];
		const destination = astroDestination({ env, write: (line: string) => lines.push(line) });
		destination.write({ level, message, label });
		return lines.map((line) => JSON.parse(line));
	}

	it('writes Astro messages in the same format, with the label and without colour codes', () => {
		const [record] = astro('info', '\u001b[32m\u001b[1mbuild\u001b[22m\u001b[39m done', 'build');

		expect(record).toEqual({ time: expect.any(String), level: 'info', msg: 'build done', label: 'build' });
	});

	it('leaves out the label when Astro gives none', () => {
		expect(astro('warn', 'careful', null)[0]).not.toHaveProperty('label');
	});

	it('follows LOG_LEVEL', () => {
		expect(astro('info', 'hidden', null, { LOG_LEVEL: 'error' })).toEqual([]);
	});
});
