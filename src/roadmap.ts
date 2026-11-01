import type { Epic } from './sources/gitlab-api.ts';

const DAY_MS = 86_400_000;
const MOST_MONTH_MARKS = 6;

interface Bar {
	epic: Epic;
	dates: string;
	/** As a percentage of the timeline, like every position here. */
	offset: number;
	length: number;
}

export interface Roadmap {
	bars: Bar[];
	months: { label: string; offset: number }[];
	unscheduled: Epic[];
}

/** Lays Epics out on a timeline of whole months, where one date alone makes a bar of one day. */
export function layOutRoadmap(epics: Epic[]): Roadmap {
	const unscheduled: Epic[] = [];
	const spans: { epic: Epic; start: number; end: number }[] = [];
	for (const epic of epics) {
		const first = epic.startDate ?? epic.dueDate;
		const last = epic.dueDate ?? epic.startDate;
		if (!first || !last) {
			unscheduled.push(epic);
			continue;
		}
		const start = Date.parse(first);
		// A due date is a whole day, and GitLab can inherit one from before the start.
		spans.push({ epic, start, end: Math.max(start, Date.parse(last)) + DAY_MS });
	}
	if (spans.length === 0) return { bars: [], months: [], unscheduled };
	spans.sort((a, b) => a.start - b.start || a.end - b.end);

	const firstMonth = startOfMonth(Math.min(...spans.map(({ start }) => start)));
	const lastDay = new Date(Math.max(...spans.map(({ end }) => end)) - DAY_MS);
	const monthCount = (lastDay.getUTCFullYear() - firstMonth.getUTCFullYear()) * 12 + lastDay.getUTCMonth() - firstMonth.getUTCMonth() + 1;
	const monthAfter = (count: number) => Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + count);

	const timelineStart = firstMonth.getTime();
	const timelineLength = monthAfter(monthCount) - timelineStart;
	const percentOfTimeline = (length: number) => Number(((length / timelineLength) * 100).toFixed(2));

	const step = Math.ceil(monthCount / MOST_MONTH_MARKS);
	return {
		bars: spans.map(({ epic, start, end }) => ({ epic, dates: describeDates(epic), offset: percentOfTimeline(start - timelineStart), length: percentOfTimeline(end - start) })),
		months: Array.from({ length: Math.ceil(monthCount / step) }, (_, index) => {
			const month = monthAfter(index * step);
			return { label: new Date(month).toISOString().slice(0, 7), offset: percentOfTimeline(month - timelineStart) };
		}),
		unscheduled,
	};
}

function startOfMonth(time: number) {
	const date = new Date(time);
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth()));
}

function describeDates({ startDate, dueDate }: Epic) {
	if (!dueDate) return `Starts ${startDate}`;
	return startDate ? `${startDate} to ${dueDate}` : `Due ${dueDate}`;
}
