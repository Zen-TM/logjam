#!/usr/bin/env bash
# Inserts a pending job marked to sharpen with the vegetation tick, as /start
# leaves one, and prints its id. Set up by hand so that no RunTask launches a
# worker for it: the caller starts its own. The ZIP goes in the bucket, and
# the settings are the ones POST /topo-jobs stores for a ticked job.
# Needs the job env's PGPASSWORD and AWS settings, and $S3_BUCKET_TOPO. Run
# from the repo root.
# Usage: ticked-job.sh <job name> <ELVIS ZIP>
set -euo pipefail

name=$1
zip=$2
id=$(cat /proc/sys/kernel/random/uuid)
key="inputs/$id/sample.zip"
aws s3 cp "$zip" "s3://$S3_BUCKET_TOPO/$key" >&2
settings=$(cd shared && node --input-type=module -e \
  "import { RASTER_TEMPLATE_DEFAULTS as d } from './dist/topoSettings.js'; console.log(JSON.stringify({ ...d, vegetation: { ...d.vegetation, enabled: true } }))")
psql -h localhost -U logjam -d logjam -v ON_ERROR_STOP=1 -q \
  -v id="$id" -v name="$name" -v key="$key" -v settings="$settings" >&2 <<'SQL'
INSERT INTO topo_jobs (id, user_id, status, name, s3_input_key, layer_options,
                       sharpen, tile_count, updated_at)
SELECT :'id', id, 'pending', :'name', :'key', :'settings'::jsonb,
       '{"v": 1, "vegetation": true}'::jsonb, 1, now()
FROM users WHERE subject = 'fake-alice-sub';
SQL
echo "$id"
