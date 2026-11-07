import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadSettings } from '../src/settings.ts';
import { writeSettings } from './support/vitrine.ts';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('loadSettings with no Settings file', () => {
	test('returns the Settings of a file with no Source and no Route, and warns', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const missing = join(mkdtempSync(join(tmpdir(), 'vitrine-')), 'settings.yaml');

		const settings = loadSettings(missing, {});

		expect(settings).toEqual(loadSettings(writeSettings({ sources: [], routes: [] }), {}));
		expect(settings.cacheStore).toEqual({ type: 'memory' });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('no settings found, using defaults'));
	});

	test('still fails, without the warning, on a path it cannot read', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const directory = mkdtempSync(join(tmpdir(), 'vitrine-'));

		expect(() => loadSettings(directory, {})).toThrow('Invalid Settings');
		expect(warn).not.toHaveBeenCalled();
	});
});
