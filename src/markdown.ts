import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

interface Bases {
	linkBase: string;
	imageBase: string;
}

/** Renders Markdown that anyone with access to a Project can write, so nothing in it may run in a Visitor's browser. */
export function renderMarkdown(markdown: string, { linkBase, imageBase }: Bases): string {
	return sanitizeHtml(marked.parse(markdown, { async: false }), {
		allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
		allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title'] },
		transformTags: {
			a: (tagName, attribs) => ({ tagName, attribs: withAbsoluteUrl(attribs, 'href', linkBase) }),
			img: (tagName, attribs) => ({ tagName, attribs: withAbsoluteUrl(attribs, 'src', imageBase) }),
		},
	});
}

function withAbsoluteUrl(attribs: Record<string, string>, name: string, base: string) {
	const value = attribs[name];
	if (value === undefined || value.startsWith('#')) return attribs;
	// In a README, a leading slash means the root of the repository.
	const url = URL.parse(value.replace(/^\/(?!\/)/, ''), base);
	return { ...attribs, [name]: url?.href ?? '' };
}
