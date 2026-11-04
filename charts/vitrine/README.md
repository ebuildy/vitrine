# Vitrine Helm chart

Deploys Vitrine, the Container image `ghcr.io/ebuildy/vitrine`, on Kubernetes: a Deployment, its Settings in a ConfigMap, a Service and, when enabled, an Ingress, a Gateway API HTTPRoute, a NetworkPolicy and a Valkey for a redis cache store.

Read [Security](../../docs/administrator/security.md) before you deploy: token permissions are the real boundary around private projects.

## Install

Each release of Vitrine publishes the chart at `oci://ghcr.io/ebuildy/charts/vitrine`, at the version of the release, such as `1.2.3`, which deploys the Container image of that release. The Valkey chart is inside.

```sh
helm install vitrine oci://ghcr.io/ebuildy/charts/vitrine --version 1.2.3 \
  --namespace portal --create-namespace --values my-values.yaml
```

Between releases, or from a fork, install it from a checkout, which deploys the Container image `edge` unless `image.tag` says otherwise:

```sh
helm repo add valkey https://valkey.io/valkey-helm/   # once, for the Valkey dependency
helm dependency build charts/vitrine
helm install vitrine charts/vitrine --namespace portal --create-namespace --values my-values.yaml
```

`kubectl logs deployment/vitrine` shows why a pod does not start: startup checks Settings and stops with a list of problems.

## Settings

`settings` holds Settings as [`settings.example.yaml`](../../settings.example.yaml) explains them, written as YAML values. The chart renders them into a ConfigMap, mounted read-only at `/etc/vitrine`, where the Container image reads `/etc/vitrine/settings.yaml`. Settings are read once, at start: a change to them rolls the pods.

`extraFiles` adds files beside Settings in the same ConfigMap, such as a stylesheet that `theme.css` lists by a path relative to Settings:

```yaml
settings:
  sources:
    - type: harbor
      name: main-harbor
      url: https://harbor.example.com
      passwordEnv: HARBOR_PASSWORD
  routes:
    - url: /
      controller: harbor-images
  theme:
    css:
      - brand.css
extraFiles:
  brand.css: |
    :root { --accent: #0b5cad; }
```

Both probes ask for `/`, so Settings need a Route to `/`, or `livenessProbe` and `readinessProbe` another path.

## Secrets

Settings name environment variables and never hold a secret: each `tokenEnv`, `passwordEnv` and `urlEnv` names one. `extraEnvs` sets them, as Kubernetes `EnvVar` entries, so a `value` or a `valueFrom.secretKeyRef`. `extraEnvFrom` sets every key of a Secret or a ConfigMap at once.

```yaml
extraEnvs:
  - name: HARBOR_PASSWORD
    valueFrom:
      secretKeyRef:
        name: vitrine-secrets
        key: harbor-password
extraEnvFrom:
  - secretRef:
      name: vitrine-gitlab   # holds GITLAB_TOKEN
```

Startup stops when a variable that Settings name is not set.

## Cache stores

A `memory` cache store, the default, needs nothing. Each pod holds its own cache, so with several replicas use `redis`.

A `files` cache store gets an `emptyDir` at `settings.cacheStore.directory`, writable by the Container image's user. `filesCache` sets that `emptyDir`, such as its `sizeLimit`. The cache goes with the pod, and fills again from the Sources or from a warm-up.

A `redis` cache store can use the Valkey this chart deploys with `valkey.enabled`. Its Service is `<release>-valkey`, on port 6379, without a password. For a release named `vitrine`:

```yaml
settings:
  cacheStore:
    type: redis
    urlEnv: VALKEY_URL
extraEnvs:
  - name: VALKEY_URL
    value: redis://vitrine-valkey:6379
valkey:
  enabled: true
```

Everything else under `valkey` goes to the [Valkey chart](https://github.com/valkey-io/valkey-helm), such as `valkey.resources` or `valkey.auth`. With `valkey.auth.enabled`, put the password in the URL, `redis://default:<password>@vitrine-valkey:6379`, from a Secret through `valueFrom`. [Cache stores](../../docs/administrator/cache-stores.md) explains each store and warm-ups.

## Warm-up

`settings.warmUp` runs a warm-up inside each pod, so that the cache holds every page before a Visitor asks for it, as [Cache stores](../../docs/administrator/cache-stores.md#warm-up) explains:

```yaml
settings:
  warmUp:
    atStart: true
    everyMinutes: 60
    concurrency: 4
```

Each pod crawls itself, never the Service. With a `memory` or `files` cache store, each replica fills its own cache, and asks the Sources for the same content. With a `redis` cache store, a replica whose warm-up runs after another's finds the content fresh and costs the Sources nothing, though replicas that start together all ask. A pod that restarts with a `memory` or `files` cache store starts cold, which `atStart` covers.

A warm-up runs once the server answers, without delaying readiness: the first pages a Visitor asks for may still wait on a Source. A NetworkPolicy needs no rule for it, as the pod requests its own address.

## Exposure

The Service sends `service.port` to the container's port 8080. Two ways to reach it from outside, both off by default:

- `ingress.enabled`: a legacy `networking.k8s.io/v1` Ingress, for `ingress.hosts`, through `ingress.className`, with `ingress.tls`.
- `httpRoute.enabled`: a Gateway API `gateway.networking.k8s.io/v1` HTTPRoute, attached to the Gateways of `httpRoute.parentRefs`, for `httpRoute.hostnames`. Each of `httpRoute.rules` sends what it matches to the Service, every path by default.

```yaml
httpRoute:
  enabled: true
  parentRefs:
    - name: main-gateway
      namespace: gateway
      sectionName: https
  hostnames:
    - vitrine.example.com
```

## NetworkPolicy

`networkPolicy.enabled` polices both directions of Vitrine's pods. `networkPolicy.ingress` and `networkPolicy.egress` are YAML strings, each a list of NetworkPolicy rules, rendered with `tpl`, so they can use `{{ .Release.Name }}`. An empty one lets nothing through in its direction.

Vitrine needs to reach DNS and every Source, and the Valkey of a redis cache store:

```yaml
networkPolicy:
  enabled: true
  ingress: |
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
      ports:
        - port: 8080
  egress: |
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
    - ports:
        - port: 443   # GitLab, Harbor and Nexus
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/instance: {{ .Release.Name }}
              app.kubernetes.io/name: valkey
      ports:
        - port: 6379
```

## Security

The pod runs as the Container image's user, uid and gid 1000, with `fsGroup` 1000, on a read-only root, without privilege escalation or any capability, under the `RuntimeDefault` seccomp profile. An `emptyDir` at `/tmp` and the one of a `files` cache store are the only places it writes. `podSecurityContext` and `securityContext` change this.

The ServiceAccount mounts no token: Vitrine never calls the Kubernetes API.

## Values

| Value | Default | What it does |
| --- | --- | --- |
| `settings` | no Source, no Route | Settings, as YAML values. |
| `extraFiles` | `{}` | More files beside Settings in `/etc/vitrine`, by file name. |
| `filesCache` | `{}` | The `emptyDir` of a `files` cache store, such as `sizeLimit`. |
| `extraEnvs` | `[]` | Environment variables, as Kubernetes `EnvVar` entries. |
| `extraEnvFrom` | `[]` | Environment variables from every key of a Secret or a ConfigMap. |
| `replicaCount` | `1` | Pods. Above 1, use a `redis` cache store. |
| `image.repository` | `ghcr.io/ebuildy/vitrine` | The Container image. |
| `image.tag` | the chart's `appVersion` | The release of a published chart, such as `1.2.3`, and `edge`, which follows `main`, from a checkout. |
| `image.pullPolicy` | `IfNotPresent` | |
| `imagePullSecrets` | `[]` | For a Container image in a private registry, such as one a fork builds. |
| `nameOverride` | `""` | Replaces the chart name in resource names. |
| `fullnameOverride` | `""` | Replaces the full resource names. |
| `serviceAccount.create` | `true` | Creates a ServiceAccount. |
| `serviceAccount.automount` | `false` | Mounts its token in the pod. |
| `serviceAccount.annotations` | `{}` | |
| `serviceAccount.name` | the full name | The ServiceAccount to create or use. |
| `podAnnotations` | `{}` | |
| `podLabels` | `{}` | |
| `podSecurityContext` | uid, gid and `fsGroup` 1000, `RuntimeDefault` | See Security. |
| `securityContext` | read-only root, no capability | See Security. |
| `service.type` | `ClusterIP` | |
| `service.port` | `80` | |
| `service.annotations` | `{}` | |
| `ingress.enabled` | `false` | Renders an Ingress. |
| `ingress.className` | `""` | |
| `ingress.annotations` | `{}` | |
| `ingress.hosts` | `vitrine.example.com`, `/` | Each a `host` and its `paths`, with `path` and `pathType`. |
| `ingress.tls` | `[]` | As in an Ingress. |
| `httpRoute.enabled` | `false` | Renders an HTTPRoute. |
| `httpRoute.annotations` | `{}` | |
| `httpRoute.parentRefs` | `[]` | The Gateways to attach to. Needed when enabled. |
| `httpRoute.hostnames` | `[]` | |
| `httpRoute.rules` | every path | Rules without `backendRefs`: each sends to the Service. |
| `networkPolicy.enabled` | `false` | Renders a NetworkPolicy. |
| `networkPolicy.ingress` | `""` | Ingress rules, as a YAML string. |
| `networkPolicy.egress` | `""` | Egress rules, as a YAML string. |
| `livenessProbe` | `GET /` every 20 s | |
| `readinessProbe` | `GET /` every 10 s | |
| `resources` | `{}` | |
| `nodeSelector` | `{}` | |
| `tolerations` | `[]` | |
| `affinity` | `{}` | |
| `valkey.enabled` | `false` | Deploys Valkey. See Cache stores. |
