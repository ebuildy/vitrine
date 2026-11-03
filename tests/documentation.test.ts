import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { z } from 'zod';
import { componentList } from '../src/component-list.ts';
import { controllerParamsSchemas } from '../src/router.ts';
import { settingsSchema } from '../src/settings.ts';

/** Every option name the schema accepts, nested ones included, as an Administrator would write it. */
function optionNames(schema: z.core.$ZodType): string[] {
	const { def } = schema._zod;
	switch (def.type) {
		case 'object':
			return Object.entries((def as z.core.$ZodObjectDef).shape).flatMap(([name, value]) => [name, ...optionNames(value)]);
		case 'union':
			return (def as z.core.$ZodUnionDef).options.flatMap(optionNames);
		case 'array':
			return optionNames((def as z.core.$ZodArrayDef).element);
		case 'optional':
		case 'default':
		case 'prefault':
		case 'nullable':
			return optionNames((def as z.core.$ZodOptionalDef).innerType);
		case 'pipe':
			return optionNames((def as z.core.$ZodPipeDef).in);
		default:
			return [];
	}
}

const example = readFileSync('settings.example.yaml', 'utf8');

test.each([...new Set(optionNames(settingsSchema))])('the example Settings file shows the option %s', (name) => {
	// An option may be commented out, as only one cache store can be set at a time.
	expect(example).toMatch(new RegExp(`^\\s*(#\\s*)?(-\\s*)?${name}:`, 'm'));
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
