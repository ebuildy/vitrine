/** Shorter words would match too much with a wrong letter, as api would match app. */
const TYPO_MIN_LENGTH = 4;

/** Text a result can be found by, where weight says how much a match in it counts. */
export interface Field {
	weight: number;
	text: string;
}

/** The words of a text, lower-cased and without accents, split on anything that is not a letter or a digit. */
export function wordsOf(text: string): string[] {
	return text
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

/** How well fields match every query word, from 0 for no match. A word matches whole, at its start, within, or with one letter wrong. */
export function matchScore(queryWords: string[], fields: Field[]): number {
	const fieldWords = fields.map(({ weight, text }) => ({ weight, words: wordsOf(text) }));
	let total = 0;
	for (const queryWord of queryWords) {
		const best = Math.max(0, ...fieldWords.flatMap(({ weight, words }) => words.map((word) => weight * wordScore(queryWord, word))));
		if (best === 0) return 0;
		total += best;
	}
	return total;
}

function wordScore(queryWord: string, word: string): number {
	if (word === queryWord) return 4;
	if (word.startsWith(queryWord)) return 3;
	if (word.includes(queryWord)) return 2;
	return queryWord.length >= TYPO_MIN_LENGTH && startsWithinOneEdit(word, queryWord) ? 1 : 0;
}

/** Whether a word, or its start, is the query word with one letter wrong, missing, added or swapped with the next. */
function startsWithinOneEdit(word: string, queryWord: string): boolean {
	const { length } = queryWord;
	return [length - 1, length, length + 1].some((end) => end <= word.length && withinOneEdit(word.slice(0, end), queryWord));
}

function withinOneEdit(a: string, b: string): boolean {
	if (Math.abs(a.length - b.length) > 1) return false;
	let same = 0;
	while (same < a.length && same < b.length && a[same] === b[same]) same++;
	if (same === a.length && same === b.length) return true;
	if (a.length > b.length) return a.slice(same + 1) === b.slice(same);
	if (a.length < b.length) return a.slice(same) === b.slice(same + 1);
	const swapped = a[same] === b[same + 1] && a[same + 1] === b[same] && a.slice(same + 2) === b.slice(same + 2);
	return swapped || a.slice(same + 1) === b.slice(same + 1);
}
