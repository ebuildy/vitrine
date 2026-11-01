import { parse } from '@astrojs/compiler-rs';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { componentList } from '../src/component-list.ts';

const DIRECTORY = 'src/components';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = Record<string, any>;

/** Reads a Component's own `Props`, so that the list is compared with the source and not with itself. */
function propsOf(file: string) {
	const { ast } = parse(readFileSync(`${DIRECTORY}/${file}`, 'utf8'));
	const props = ast.frontmatter?.program.body.find((statement: Node) => statement.type === 'TSInterfaceDeclaration' && statement.id.name === 'Props');
	if (!props) throw new Error(`${file} has no Props`);
	return Object.fromEntries(props.body.body.map((member: Node) => [member.key.name, !member.optional]));
}

const files = readdirSync(DIRECTORY);

test('the list names every Component and nothing else', () => {
	expect(Object.keys(componentList).sort()).toEqual(files.map((file) => file.replace('.astro', '')).sort());
});

test.each(files)('the list holds the props of %s', (file) => {
	expect(componentList[file.replace('.astro', '')].props).toEqual(propsOf(file));
});

test.each(files)('the list holds the Source type of %s', (file) => {
	const source = readFileSync(`${DIRECTORY}/${file}`, 'utf8');
	const reads = source.includes('getHarborSource(') ? 'harbor' : source.includes('getGitlabSource(') ? 'gitlab' : undefined;

	expect(reads).toBeDefined();
	expect(componentList[file.replace('.astro', '')].sourceType).toBe(reads);
});
