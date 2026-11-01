import type { Source } from './settings.ts';

export interface ComponentEntry {
	/** Every prop of the Component, true when it is required. */
	props: Record<string, boolean>;
	sourceType: Source['type'];
}

const onGroup = { sourceType: 'gitlab', props: { source: true, group: true } } as const;
const onProject = { sourceType: 'gitlab', props: { source: true, project: true } } as const;

/** Every Component a Template can place. start.ts reads this outside the build, so it names Components and cannot import them. */
export const componentList: Record<string, ComponentEntry> = {
	GitlabCommitList: onProject,
	GitlabContributorList: onProject,
	GitlabEpics: onGroup,
	GitlabGroupIssues: onGroup,
	GitlabGroupList: onGroup,
	GitlabGroupSummary: onGroup,
	GitlabProjectIssues: onProject,
	GitlabProjectList: onGroup,
	GitlabProjectSummary: onProject,
	GitlabReadme: onProject,
	GitlabReleaseList: onProject,
	GroupMembers: { sourceType: 'gitlab', props: { source: true, group: true, deep: false } },
	GroupRoadmap: onGroup,
	HarborProjectList: { sourceType: 'harbor', props: { source: true } },
	ImageList: { sourceType: 'harbor', props: { source: true, project: true } },
};
