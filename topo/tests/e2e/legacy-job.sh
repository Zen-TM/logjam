#!/usr/bin/env bash
# Inserts a pending job with no sharpen mark, as one left from before the
# switch flipped, and prints its id. The API marks every new job to sharpen
# (SHARPEN_NEW_JOBS), so a legacy run is set up by hand: the ZIP in the
# bucket, and the settings and vector style POST /topo-jobs would store.
# Needs the job env's PGPASSWORD and AWS settings, and $S3_BUCKET_TOPO. Run
# from the repo root.
# Usage: legacy-job.sh <job name> <ELVIS ZIP>
set -euo pipefail

name=$1
zip=$2
id=$(cat /proc/sys/kernel/random/uuid)
key="inputs/$id/sample.zip"
aws s3 cp "$zip" "s3://$S3_BUCKET_TOPO/$key" >&2
defaults() { (cd shared && node --input-type=module -e \
  "import * as s from './dist/topoSettings.js'; console.log(JSON.stringify(s.$1))"); }
psql -h localhost -U logjam -d logjam -v ON_ERROR_STOP=1 -q \
  -v id="$id" -v name="$name" -v key="$key" \
  -v settings="$(defaults RASTER_TEMPLATE_DEFAULTS)" \
  -v style="$(defaults VECTOR_STYLE_DEFAULTS)" >&2 <<'SQL'
INSERT INTO topo_jobs (id, user_id, status, name, s3_input_key, layer_options,
                       vector_style_snapshot, tile_count, updated_at)
SELECT :'id', id, 'pending', :'name', :'key', :'settings'::jsonb,
       :'style'::jsonb, 1, now()
FROM users WHERE cognito_id = 'fake-alice-sub';
SQL
echo "$id"
