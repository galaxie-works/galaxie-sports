#!/bin/bash
v() { grep -E "^$1=" "${GALAXIE_ENV:-/g/galaxie-sports/.env}" | cut -d= -f2-; }
SID=$(v S3_ACCESS_KEY); SKEY=$(v S3_SECRET_KEY)
scp -q "$(dirname "$0")/s3copy.mjs" root@145.223.94.149:/tmp/s3copy.mjs
ssh -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -R 19000:192.168.1.34:9000 root@145.223.94.149 "cd /docker/galaxie-sports && set -a && . ./.env && set +a && IMG=\$(docker compose images -q ingestor | head -1) && docker run --rm --network host -v /tmp/s3copy.mjs:/srv/services/ingestor/s3copy.mjs -w /srv/services/ingestor \
 -e SRC_ENDPOINT=http://127.0.0.1:19000 -e SRC_ID='$SID' -e SRC_KEY='$SKEY' \
 -e DST_ENDPOINT=http://172.30.50.3:9000 -e DST_ID=\"\$S3_ACCESS_KEY\" -e DST_KEY=\"\$S3_SECRET_KEY\" -e BUCKET=galaxie-sports-assets \
 --entrypoint node \$IMG s3copy.mjs"
