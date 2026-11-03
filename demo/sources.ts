import { startFakeGitlab } from '../tests/support/fake-gitlab.ts';
import { startFakeHarbor } from '../tests/support/fake-harbor.ts';
import { startFakeNexus } from '../tests/support/fake-nexus.ts';
import { freePort } from '../tests/support/free-port.ts';
import { gitlabContent, mainHarborContent, nexusContent, toolsHarborContent } from './content.ts';

/** Starts a fake of every Source in demo/settings.yaml, each on a free port, asking for the secrets Vitrine reads. */
export async function startDemoSources({ gitlabToken, harborPassword }: { gitlabToken: string; harborPassword: string }) {
	// GitLab's content links back to it, so it needs its port first.
	const gitlabPort = await freePort();
	const gitlab = await startFakeGitlab({ ...gitlabContent(`http://127.0.0.1:${gitlabPort}`), token: gitlabToken, port: gitlabPort });
	const mainHarbor = await startFakeHarbor({ ...mainHarborContent, credentials: { username: 'robot$vitrine', password: harborPassword } });
	const toolsHarbor = await startFakeHarbor(toolsHarborContent);
	const nexus = await startFakeNexus(nexusContent);
	const fakes = { 'main-gitlab': gitlab, 'main-harbor': mainHarbor, 'tools-harbor': toolsHarbor, 'main-nexus': nexus };
	return {
		fakes,
		urls: Object.fromEntries(Object.entries(fakes).map(([name, { url }]) => [name, url])),
		stop: () => Promise.all(Object.values(fakes).map((fake) => fake.stop())),
	};
}
