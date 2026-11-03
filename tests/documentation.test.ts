import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { z } from 'zod';
import { componentList } from '../src/component-list.ts';
import { controllerParamsSchemas } from '../src/router.ts';
import { settingsSchema } from '../src/settings.ts';

/** Every option the schema accepts, as a dotted path such as `theme.dark.primary`; array items add no segment. */
function optionPaths(schema: z.core.$ZodType, prefix = ''): string[] {
	const { def } = schema._zod;
	switch (def.type) {
		case 'object':
			return Object.entries((def as z.core.$ZodObjectDef).shape).flatMap(([name, value]) => [
				prefix + name,
				...optionPaths(value, `${prefix}${name}.`),
			]);
		case 'union':
			return (def as z.core.$ZodUnionDef).options.flatMap((option) => optionPaths(option, prefix));
		case 'array':
			return optionPaths((def as z.core.$ZodArrayDef).element, prefix);
		case 'optional':
		case 'default':
		case 'prefault':
		case 'nullable':
			return optionPaths((def as z.core.$ZodOptionalDef).innerType, prefix);
		case 'pipe':
			return optionPaths((def as z.core.$ZodPipeDef).in, prefix);
		default:
			return [];
	}
}

/**
 * The dotted path of every key a YAML file shows, read from its indentation. A commented-out key counts,
 * as only one cache store can be set at a time, when its value is a single word: `# type: files` is a key,
 * `# name: picks a Theme` is prose.
 */
function yamlKeyPaths(yaml: string): Set<string> {
	const paths = new Set<string>();
	const parents: { indent: number; key: string }[] = [];
	let blockIndent = Infinity;
	for (const line of yaml.split('\n')) {
		const indent = line.search(/\S/);
		if (indent === -1) continue;
		if (indent > blockIndent) continue; // Inside a `|` block, such as a Template.
		blockIndent = Infinity;
		const key =
			/^\s*(?:-\s+)?([A-Za-z]\w*):(?:\s|$)/.exec(line) ?? /^\s*#\s*(?:-\s+)?([A-Za-z]\w*):(?:\s+\S+)?\s*$/.exec(line);
		if (!key) continue;
		// A key's indent is where the key itself starts, after any `- ` or `# `, so siblings line up.
		const keyIndent = line.trimStart().startsWith('#') ? indent : line.indexOf(key[1]);
		while (parents.length > 0 && parents.at(-1)!.indent >= keyIndent) parents.pop();
		paths.add([...parents.map((parent) => parent.key), key[1]].join('.'));
		parents.push({ indent: keyIndent, key: key[1] });
		if (/:\s*[|>][-+]?\s*$/.test(line)) blockIndent = indent;
	}
	return paths;
}

const exampleKeys = yamlKeyPaths(readFileSync('settings.example.yaml', 'utf8'));

test.each([...new Set(optionPaths(settingsSchema))])('the example Settings file shows the option %s', (path) => {
	expect(exampleKeys).toContain(path);
});

/** The text under each `## ` heading of a Markdown file, keyed by the heading without its backquotes. */
function sections(path: string) {
	const parts = readFileSync(path, 'utf8').split(/^## /m).slice(1);
	return new Map(parts.map((part) => [part.slice(0, part.indexOf('\n')).replaceAll('`', '').trim(), part]));
}

const controllers = sections('docs/administrator/controllers.md');

test.each(Object.entries(controllerParamsSchemas))('the Controller %s is documented with each of its params', (name, schema) => {
	const section = controllers.get(name);

	expect(section).toBeDefined();
	for (const param of Object.keys(schema.shape)) expect(section).toContain(`\`${param}\``);
});

const components = sections('docs/administrator/components.md');

test.each(Object.entries(componentList))('the Component %s is documented with each of its props', (name, { props }) => {
	const section = components.get(name);

	expect(section).toBeDefined();
	for (const prop of Object.keys(props)) expect(section).toContain(`\`${prop}\``);
});

/** Words `GLOSSARY.md` lists under _Avoid_, each with the term to write instead. Only those with no innocent use. */
const avoidedWords: [RegExp, string][] = [
	[/\bblocks?\b/i, 'Component'],
	[/\bwidgets?\b/i, 'Component'],
	[/\bDocker images?\b/i, 'Container image'],
	[/\badmins?\b(?!'s token)/i, 'Administrator'],
	[/\bnavbar\b|\bnavigation bar\b/i, 'Menu'],
	[/\bdashboard\b|\blanding page\b/i, 'Navigation page'],
	[/\bdark theme\b|\blight theme\b|\bnight mode\b/i, 'Colour mode'],
	[/\bwhite label\b/i, 'Branding'],
	[/\broot group\b|\btop-level group\b/i, 'Main Group'],
	[/\bwork items?\b/i, 'Issue or Epic'],
];

const administratorDocs = [
	'README.md',
	'settings.example.yaml',
	...readdirSync('docs/administrator').map((file) => `docs/administrator/${file}`),
];

test.each(administratorDocs)('%s uses the glossary terms', (path) => {
	const lines = readFileSync(path, 'utf8').split('\n');
	const misuses = lines.flatMap((line, index) =>
		avoidedWords.filter(([word]) => word.test(line)).map(([word, term]) => `line ${index + 1}: ${word} → ${term}`),
	);

	expect(misuses).toEqual([]);
});
