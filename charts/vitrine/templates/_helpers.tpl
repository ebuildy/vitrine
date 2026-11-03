{{- define "vitrine.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "vitrine.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "vitrine.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "vitrine.labels" -}}
helm.sh/chart: {{ include "vitrine.chart" . }}
{{ include "vitrine.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "vitrine.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vitrine.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Non-empty when Settings use a files cache store, which needs a writable directory. */}}
{{- define "vitrine.filesCacheStore" -}}
{{- if eq (dig "cacheStore" "type" "" .Values.settings) "files" }}true{{ end }}
{{- end }}

{{- define "vitrine.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "vitrine.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
