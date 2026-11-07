// Plain JavaScript, because Astro loads its logger entrypoint without compiling TypeScript.

/**
 * @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel
 * @typedef {Record<string, unknown>} LogFields
 * @typedef {Record<string, string | undefined>} Environment
 * @typedef {{ env?: Environment, write?: (line: string) => void }} LoggerOptions
 */

const RANK = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
const LEVELS = Object.keys(RANK);
const ANSI_COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** @param {string | undefined} value */
function isLevel(value) {
	return value !== undefined && Object.hasOwn(RANK, value);
}

/** Stops on a LOG_LEVEL that is not a level. An unset or empty one means `info`. */
export function checkLogLevel(/** @type {Environment} */ env = process.env) {
	const { LOG_LEVEL: value } = env;
	if (value && !isLevel(value)) {
		throw new Error(`LOG_LEVEL "${value}" is not valid, use ${LEVELS.slice(0, -1).join(', ')} or ${LEVELS.at(-1)}`);
	}
}

/** Reads LOG_LEVEL at each message, so that one loaded from a .env file after the logger is created still applies. */
function rankOf(/** @type {Environment} */ env) {
	checkLogLevel(env);
	return RANK[/** @type {keyof typeof RANK} */ (env.LOG_LEVEL || 'info')];
}

/** An Error has no enumerable fields, so JSON.stringify would turn it into `{}`. */
function replacer(/** @type {string} */ _key, /** @type {unknown} */ value) {
	return value instanceof Error ? { message: value.message, stack: value.stack } : value;
}

/** @param {string} level @param {string} msg @param {LogFields} fields @param {(line: string) => void} write */
function emit(level, msg, fields, write) {
	// A field named like one of the three cannot replace it.
	const { time: _time, level: _level, msg: _msg, ...extra } = fields;
	write(JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra }, replacer));
}

const toStdout = (/** @type {string} */ line) => process.stdout.write(`${line}\n`);

/** A logger writing one JSON object per line. */
export function createLogger({ env = process.env, write = toStdout } = /** @type {LoggerOptions} */ ({})) {
	/** @param {LogLevel} level @param {string} msg @param {LogFields} [fields] */
	const log = (level, msg, fields = {}) => {
		if (RANK[level] >= rankOf(env)) emit(level, msg, fields, write);
	};
	return {
		/** @param {string} msg @param {LogFields} [fields] */
		debug: (msg, fields) => log('debug', msg, fields),
		/** @param {string} msg @param {LogFields} [fields] */
		info: (msg, fields) => log('info', msg, fields),
		/** @param {string} msg @param {LogFields} [fields] */
		warn: (msg, fields) => log('warn', msg, fields),
		/** @param {string} msg @param {LogFields} [fields] */
		error: (msg, fields) => log('error', msg, fields),
	};
}

export const logger = createLogger();

/** Where Astro sends its own messages, in the same format as Vitrine's. */
export function astroDestination({ env = process.env, write = toStdout } = /** @type {LoggerOptions} */ ({})) {
	return {
		write(/** @type {{ level: string, message: string, label?: string | null }} */ { level, message, label }) {
			if (RANK[/** @type {keyof typeof RANK} */ (level)] < rankOf(env)) return;
			emit(level, message.replace(ANSI_COLOUR, ''), label ? { label } : {}, write);
		},
	};
}

/** The entrypoint Astro loads: `logger.entrypoint` in astro.config.mjs. */
export default function () {
	return astroDestination();
}
