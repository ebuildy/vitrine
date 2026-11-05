import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseAllDocuments, stringify } from 'yaml';

const CHART = 'charts/vitrine';

interface Manifest {
	apiVersion: string;
	kind: string;
	metadata: { name: string; annotations?: Record<string, string> };
	[field: string]: any;
}

let helmHome: string;

function helm(args: string[], input = '') {
	return execFileSync('helm', args, {
		input,
		encoding: 'utf8',
		stdio: ['pipe', 'pipe', 'inherit'],
		env: {
			...process.env,
			HELM_CONFIG_HOME: join(helmHome, 'config'),
			HELM_CACHE_HOME: join(helmHome, 'cache'),
			HELM_DATA_HOME: join(helmHome, 'data'),
		},
	});
}

/** What `helm template` renders from the chart with these values, as Kubernetes would receive it. */
function render(values: object = {}): Manifest[] {
	const output = helm(['template', 'vitrine', CHART, '--namespace', 'portal', '--values', '-'], stringify(values));
	return parseAllDocuments(output)
		.map((document) => document.toJS() as Manifest | null)
		.filter((manifest): manifest is Manifest => manifest !== null);
}

function find(manifests: Manifest[], kind: string): Manifest | undefined {
	return manifests.find((manifest) => manifest.kind === kind);
}

function deployment(manifests: Manifest[]) {
	const found = find(manifests, 'Deployment');
	if (!found) throw new Error('No Deployment rendered');
	return found;
}

function container(manifests: Manifest[]) {
	return deployment(manifests).spec.template.spec.containers[0];
}

/** The volume a container mounts at this path, and where it mounts it. */
function volumeAt(manifests: Manifest[], path: string) {
	const mount = container(manifests).volumeMounts.find((candidate: any) => candidate.mountPath === path);
	if (!mount) return undefined;
	return { mount, volume: deployment(manifests).spec.template.spec.volumes.find((volume: any) => volume.name === mount.name) };
}

const SETTINGS = {
	sources: [{ type: 'harbor', name: 'main-harbor', url: 'https://harbor.example.com' }],
	routes: [{ url: '/', controller: 'harbor-images' }],
};

describe('the Helm chart', () => {
	/** Fetches the Valkey chart from a Helm home of the test's own, so that a developer's repositories stay as they are. */
	beforeAll(() => {
		helmHome = mkdtempSync(join(tmpdir(), 'vitrine-helm-'));
		helm(['repo', 'add', 'valkey', 'https://valkey.io/valkey-helm/']);
		helm(['dependency', 'build', CHART]);
	}, 60_000);

	afterAll(() => {
		rmSync(helmHome, { recursive: true, force: true });
	});

	test('mounts Settings from a ConfigMap at /etc/vitrine/settings.yaml, where the Container image reads them', () => {
		const manifests = render({ settings: SETTINGS });
		const configMap = find(manifests, 'ConfigMap');
		const directory = volumeAt(manifests, '/etc/vitrine');

		expect(configMap).toBeDefined();
		expect(parseAllDocuments(configMap!.data['settings.yaml'])[0].toJS()).toEqual(SETTINGS);
		expect(directory?.mount.readOnly).toBe(true);
		expect(directory?.volume.configMap.name).toBe(configMap!.metadata.name);
	});

	test('rolls the pods when Settings change', () => {
		const before = deployment(render({ settings: SETTINGS })).spec.template.metadata.annotations;
		const after = deployment(render({ settings: { ...SETTINGS, branding: { siteName: 'Portal' } } })).spec.template.metadata.annotations;

		expect(after['checksum/settings']).toMatch(/^[0-9a-f]{64}$/);
		expect(after['checksum/settings']).not.toBe(before['checksum/settings']);
	});

	test('runs as uid 1000, unprivileged, on a read-only root', () => {
		const manifests = render();
		const pod = deployment(manifests).spec.template.spec.securityContext;
		const { securityContext } = container(manifests);

		expect(pod).toMatchObject({ runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, seccompProfile: { type: 'RuntimeDefault' } });
		expect(securityContext).toMatchObject({
			runAsNonRoot: true,
			readOnlyRootFilesystem: true,
			allowPrivilegeEscalation: false,
			capabilities: { drop: ['ALL'] },
			seccompProfile: { type: 'RuntimeDefault' },
		});
	});

	test('gives the read-only root a writable /tmp', () => {
		expect(volumeAt(render(), '/tmp')?.volume.emptyDir).toBeDefined();
	});

	test('mounts an emptyDir at the directory of a files cache store', () => {
		const manifests = render({ settings: { ...SETTINGS, cacheStore: { type: 'files', directory: '/var/cache/vitrine' } } });

		expect(volumeAt(manifests, '/var/cache/vitrine')?.volume.emptyDir).toBeDefined();
	});

	test('mounts no cache directory for a cache store in memory', () => {
		const volumes = deployment(render({ settings: { ...SETTINGS, cacheStore: { type: 'memory' } } })).spec.template.spec.volumes;

		expect(volumes.map((volume: any) => volume.name).sort()).toEqual(['settings', 'tmp']);
	});

	test('passes extraEnvs to the container as they are, such as a secretKeyRef', () => {
		const extraEnvs = [
			{ name: 'NEXUS_URL', value: 'https://nexus.example.com' },
			{ name: 'GITLAB_TOKEN', valueFrom: { secretKeyRef: { name: 'vitrine-secrets', key: 'gitlab-token' } } },
		];
		const extraEnvFrom = [{ secretRef: { name: 'vitrine-secrets' } }];
		const { env, envFrom } = container(render({ extraEnvs, extraEnvFrom }));

		expect(env).toEqual(extraEnvs);
		expect(envFrom).toEqual(extraEnvFrom);
	});

	test('probes / on port 8080', () => {
		const { livenessProbe, readinessProbe, ports } = container(render());

		expect(ports).toContainEqual(expect.objectContaining({ name: 'http', containerPort: 8080 }));
		expect(livenessProbe.httpGet).toEqual({ path: '/', port: 'http' });
		expect(readinessProbe.httpGet).toEqual({ path: '/', port: 'http' });
	});

	test('renders a Service, and no Ingress, HTTPRoute, NetworkPolicy or Valkey by default', () => {
		const kinds = render().map((manifest) => manifest.kind);

		expect(kinds).toContain('Service');
		expect(kinds).not.toContain('Ingress');
		expect(kinds).not.toContain('HTTPRoute');
		expect(kinds).not.toContain('NetworkPolicy');
		expect(render().filter((manifest) => manifest.metadata.name.includes('valkey'))).toEqual([]);
	});

	test('sends the Service to port 8080', () => {
		const service = find(render(), 'Service')!;

		expect(service.spec.ports).toEqual([{ name: 'http', port: 80, targetPort: 'http', protocol: 'TCP' }]);
		expect(service.spec.selector).toEqual(deployment(render()).spec.selector.matchLabels);
	});

	test('renders a legacy Ingress to the Service when enabled', () => {
		const manifests = render({
			ingress: { enabled: true, className: 'nginx', hosts: [{ host: 'vitrine.example.com', paths: [{ path: '/', pathType: 'Prefix' }] }], tls: [{ secretName: 'vitrine-tls', hosts: ['vitrine.example.com'] }] },
		});
		const ingress = find(manifests, 'Ingress')!;

		expect(ingress.apiVersion).toBe('networking.k8s.io/v1');
		expect(ingress.spec.ingressClassName).toBe('nginx');
		expect(ingress.spec.tls).toEqual([{ secretName: 'vitrine-tls', hosts: ['vitrine.example.com'] }]);
		expect(ingress.spec.rules).toEqual([
			{
				host: 'vitrine.example.com',
				http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'vitrine', port: { name: 'http' } } } }] },
			},
		]);
	});

	test('renders a Gateway API HTTPRoute to the Service when enabled', () => {
		const manifests = render({ httpRoute: { enabled: true, parentRefs: [{ name: 'main-gateway', namespace: 'gateway' }], hostnames: ['vitrine.example.com'] } });
		const route = find(manifests, 'HTTPRoute')!;

		expect(route.apiVersion).toBe('gateway.networking.k8s.io/v1');
		expect(route.spec.parentRefs).toEqual([{ name: 'main-gateway', namespace: 'gateway' }]);
		expect(route.spec.hostnames).toEqual(['vitrine.example.com']);
		expect(route.spec.rules).toEqual([{ matches: [{ path: { type: 'PathPrefix', value: '/' } }], backendRefs: [{ name: 'vitrine', port: 80 }] }]);
	});

	test('renders the NetworkPolicy rules given as YAML strings, through tpl', () => {
		const manifests = render({
			networkPolicy: {
				enabled: true,
				ingress: '- from:\n    - namespaceSelector:\n        matchLabels:\n          kubernetes.io/metadata.name: ingress-nginx\n',
				egress: '- to:\n    - podSelector:\n        matchLabels:\n          app.kubernetes.io/instance: {{ .Release.Name }}\n',
			},
		});
		const policy = find(manifests, 'NetworkPolicy')!;

		expect(policy.spec.podSelector.matchLabels).toEqual(deployment(manifests).spec.selector.matchLabels);
		expect(policy.spec.policyTypes).toEqual(['Ingress', 'Egress']);
		expect(policy.spec.ingress).toEqual([{ from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'ingress-nginx' } } }] }]);
		expect(policy.spec.egress).toEqual([{ to: [{ podSelector: { matchLabels: { 'app.kubernetes.io/instance': 'vitrine' } } }] }]);
	});

	test('denies all traffic of a direction whose NetworkPolicy rules are empty', () => {
		const policy = find(render({ networkPolicy: { enabled: true } }), 'NetworkPolicy')!;

		expect(policy.spec.policyTypes).toEqual(['Ingress', 'Egress']);
		expect(policy.spec.ingress).toBeUndefined();
		expect(policy.spec.egress).toBeUndefined();
	});

	test('renders no ServiceMonitor by default', () => {
		expect(find(render(), 'ServiceMonitor')).toBeUndefined();
	});

	test('renders a ServiceMonitor that reads /metrics with the bearer token of a Secret', () => {
		const monitor = find(render({ metrics: { serviceMonitor: { enabled: true, bearerTokenSecret: { name: 'vitrine-metrics', key: 'token' } } } }), 'ServiceMonitor')!;

		expect(monitor.apiVersion).toBe('monitoring.coreos.com/v1');
		expect(monitor.spec.endpoints).toEqual([{ port: 'http', path: '/metrics', authorization: { type: 'Bearer', credentials: { name: 'vitrine-metrics', key: 'token' } } }]);
	});

	test('renders a ServiceMonitor without a token when no Secret is given', () => {
		const monitor = find(render({ metrics: { serviceMonitor: { enabled: true } } }), 'ServiceMonitor')!;

		expect(monitor.spec.endpoints).toEqual([{ port: 'http', path: '/metrics' }]);
	});

	test('deploys Valkey beside Vitrine when enabled', () => {
		const service = render({ valkey: { enabled: true } }).find((manifest) => manifest.metadata.name === 'vitrine-valkey' && manifest.kind === 'Service');

		expect(service?.spec.ports).toContainEqual(expect.objectContaining({ port: 6379 }));
	});

	test('passes helm lint with everything enabled', () => {
		const values = stringify({
			settings: { ...SETTINGS, cacheStore: { type: 'files', directory: '/var/cache/vitrine' } },
			ingress: { enabled: true },
			httpRoute: { enabled: true, parentRefs: [{ name: 'main-gateway' }] },
			networkPolicy: { enabled: true, ingress: '- {}', egress: '- {}' },
			valkey: { enabled: true },
		});

		expect(() => helm(['lint', '--strict', CHART, '--values', '-'], values)).not.toThrow();
	});
});
