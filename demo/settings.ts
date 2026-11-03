import { parseDocument } from 'yaml';

/** Returns the Settings with each named Source at the URL of its fake, which listens wherever a port was free. */
export function withSourceUrls(settings: string, urls: Record<string, string>): string {
	const document = parseDocument(settings);
	const sources = document.toJS().sources as { name: string }[];
	sources.forEach(({ name }, index) => {
		if (!urls[name]) throw new Error(`The demo starts no fake for Source "${name}": add one to demo/start.ts`);
		document.setIn(['sources', index, 'url'], urls[name]);
	});
	return document.toString();
}
