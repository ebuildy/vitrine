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
	const unscheduled = epics.filter(({ startDate, dueDate }) => !startDate && !dueDate);
	const spans = epics
		.filter((epic) => !unscheduled.includes(epic))
		.map((epic) => {
			const start = Date.parse((epic.startDate ?? epic.dueDate) as string);
			const due = Date.parse((epic.dueDate ?? epic.startDate) as string);
			// A due date is a whole day, and GitLab can inherit one from before the start.
			return { epic, start, end: Math.max(start, due) + DAY_MS };
		})
		.toSorted((a, b) => a.start - b.start || a.end - b.end);
	if (spans.length === 0) return { bars: [], months: [], unscheduled };

	const firstMonth = startOfMonth(Math.min(...spans.map(({ start }) => start)));
	const lastDay = new Date(Math.max(...spans.map(({ end }) => end)) - DAY_MS);
	const monthCount = (lastDay.getUTCFullYear() - firstMonth.getUTCFullYear()) * 12 + lastDay.getUTCMonth() - firstMonth.getUTCMonth() + 1;
	const monthAfter = (count: number) => Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + count);

	const timelineStart = firstMonth.getTime();
	const timelineLength = monthAfter(monthCount) - timelineStart;
	const position = (length: number) => Number(((length / timelineLength) * 100).toFixed(2));

	const step = Math.ceil(monthCount / MOST_MONTH_MARKS);
	return {
		bars: spans.map(({ epic, start, end }) => ({ epic, dates: describeDates(epic), offset: position(start - timelineStart), length: position(end - start) })),
		months: Array.from({ length: Math.ceil(monthCount / step) }, (_, index) => {
			const month = monthAfter(index * step);
			return { label: new Date(month).toISOString().slice(0, 7), offset: position(month - timelineStart) };
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
