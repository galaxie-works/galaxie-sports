#!/bin/bash
. "$(dirname "$0")/hosts.sh"
SID=$(env_get S3_ACCESS_KEY); SKEY=$(env_get S3_SECRET_KEY)
scp -q "$(dirname "$0")/s3copy.mjs" "$VPS:/tmp/s3copy.mjs"
ssh -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -R "19000:$NAS_S3" "$VPS" "cd '$VPS_DIR' && set -a && . ./.env && set +a && IMG=\$(docker compose images -q ingestor | head -1) && S3IP=\$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' \$(docker compose -f compose.dados.yml ps -q s3) | cut -d' ' -f1) && docker run --rm --network host -v /tmp/s3copy.mjs:/srv/services/ingestor/s3copy.mjs -w /srv/services/ingestor \
 -e SRC_ENDPOINT=http://127.0.0.1:19000 -e SRC_ID='$SID' -e SRC_KEY='$SKEY' \
 -e DST_ENDPOINT=http://\$S3IP:9000 -e DST_ID=\"\$S3_ACCESS_KEY\" -e DST_KEY=\"\$S3_SECRET_KEY\" -e BUCKET=galaxie-sports-assets \
 --entrypoint node \$IMG s3copy.mjs"
