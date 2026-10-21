#!/usr/bin/env bash
# Creates a topo job as Logjam Web does (POST /topo-jobs, a PUT to the
# presigned URL, POST /topo-jobs/:id/start) and prints its id. /start calls
# ECS RunTask. Run from the repo root, with the API on :8080.
# Usage: start-job.sh <job name> <ELVIS ZIP>
set -euo pipefail

name=$1
zip=$2
api=http://localhost:8080

# Logjam Web sends the default settings unless the user changes them.
settings=$(cd shared && node --input-type=module -e \
  "import { RASTER_TEMPLATE_DEFAULTS as d } from './dist/topoSettings.js'; console.log(JSON.stringify(d))")
created=$(jq -n --arg name "$name" --argjson settings "$settings" \
    '{jobName: $name, tileCount: 1, settings: $settings}' \
  | curl -sf -X POST "$api/topo-jobs" -H 'content-type: application/json' -d @-)
id=$(jq -r .jobId <<<"$created")
curl -sf -X PUT -H 'content-type: application/zip' --upload-file "$zip" "$(jq -r .uploadUrl <<<"$created")"
curl -sf -X POST "$api/topo-jobs/$id/start" | jq -e '.status == "pending"' >&2
echo "$id"
