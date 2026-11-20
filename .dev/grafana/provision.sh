#!/bin/sh
# Loads dashboards/*.json into Grafana. Its file provider does not read the v2 schema (tabs and rows), so this goes through the API:
# a PUT replaces the dashboard, a POST creates it the first time.
set -eu
api="$GRAFANA_URL/apis/dashboard.grafana.app/v2/namespaces/default/dashboards"
for file in /dashboards/*.json; do
  name=$(basename "$file" .json)
  code=$(curl -s -o /tmp/answer -w '%{http_code}' -X PUT -H 'Content-Type: application/json' "$api/$name" -d @"$file")
  if [ "$code" = 404 ]; then
    code=$(curl -s -o /tmp/answer -w '%{http_code}' -X POST -H 'Content-Type: application/json' "$api" -d @"$file")
  fi
  if [ "$code" != 200 ] && [ "$code" != 201 ]; then
    echo "$name: HTTP $code" >&2
    cat /tmp/answer >&2
    exit 1
  fi
  echo "$name: loaded"
done
