import { resolveIconName } from './icon-names.ts';
import type { IconName, IconQuery } from './icon-names.ts';

export interface Icon {
	name: IconName;
	/** The address of the logo, part of the build, so that a Visitor's browser never asks a Source for it. */
	url: string;
}

// Every file of src/icons/, by its name: icon-names.test.ts keeps this in step with ICON_NAMES.
const URLS = import.meta.glob<string>('./icons/*.svg', { query: '?url', import: 'default', eager: true });

/** The icon for a Nexus format, an Image name or an icon name, or nothing when none fits. Only code the build bundles may import this. */
export function resolveIcon(query: IconQuery): Icon | undefined {
	const name = resolveIconName(query);
	const url = name && URLS[`./icons/${name}.svg`];
	return name && url ? { name, url } : undefined;
}
