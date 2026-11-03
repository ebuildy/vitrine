import gitlabIcon from './icons/gitlab.svg?url';
import harborIcon from './icons/harbor.svg?url';
import type { Source } from './settings.ts';

export interface SourceLook {
	/** A CSS colour that marks content of this kind of Source. */
	colour: string;
	/** The address of the logo, which is part of the build, so a Visitor's browser never asks a Source for it. */
	icon: string;
}

/**
 * The colour and logo of each kind of Source, so a Visitor tells them apart at a glance, on any page. A Nexus Source
 * would be green. Only code the build bundles may import this, as Node itself cannot load an .svg?url import.
 */
export const SOURCE_LOOKS: Record<Source['type'], SourceLook> = {
	// GitLab's tanuki, from app/assets/images/logo.svg of gitlab-org/gitlab.
	gitlab: { colour: '#fc6d26', icon: gitlabIcon },
	// Harbor's icon, from projects/harbor/icon/color of the CNCF artwork repository.
	harbor: { colour: '#1d6fd1', icon: harborIcon },
};
