#!/bin/sh
# Post a camera's snapshot to a Visual Timeline backend once per cadence.
#
# Almost every IP camera and NVR has a snapshot URL, for example:
#   Hikvision  http://CAMERA/ISAPI/Streaming/channels/101/picture
#   Dahua      http://CAMERA/cgi-bin/snapshot.cgi
#   Axis       http://CAMERA/axis-cgi/jpg/image.cgi
#   Frigate    http://FRIGATE:5000/api/CAMERA_NAME/latest.jpg
# (ONVIF cameras advertise theirs through GetSnapshotUri.)
#
# Usage (one process per camera):
#   VT_URL=http://localhost:8787 VT_SITE=home VT_SOURCE=driveway \
#   VT_TOKEN=<the site's upload token> \
#   SNAPSHOT_URL=http://camera.lan/cgi-bin/snapshot.cgi \
#   SNAPSHOT_AUTH=user:password \
#   sh snapshot-uploader.sh
#
# Optional: CADENCE (seconds, default 60), WIDTH (default 640),
# VT_TIMEZONE (an IANA name such as Australia/Brisbane, if the camera burns a
# clock into the image), SNAPSHOT_AUTH_TYPE (digest, the default, or basic;
# it becomes curl's --digest or --basic).
# Needs curl and ffmpeg.
#
# A failed snapshot or upload is dropped, never retried: the gap on the
# timeline is how a dead camera shows up.

set -u
: "${VT_URL:?}" "${VT_SITE:?}" "${VT_SOURCE:?}" "${VT_TOKEN:?}" "${SNAPSHOT_URL:?}"
CADENCE="${CADENCE:-60}"
WIDTH="${WIDTH:-640}"
RAW="${TMPDIR:-/tmp}/vt-${VT_SITE}-${VT_SOURCE}.raw"
FRAME="${TMPDIR:-/tmp}/vt-${VT_SITE}-${VT_SOURCE}.jpg"

# the snapshot request, with the camera's credentials if it needs them
if [ -z "${SNAPSHOT_AUTH:-}" ]; then
  snapshot() { curl -sf --max-time 10 "$SNAPSHOT_URL"; }
else
  snapshot() { curl -sf --max-time 10 "--${SNAPSHOT_AUTH_TYPE:-digest}" -u "$SNAPSHOT_AUTH" "$SNAPSHOT_URL"; }
fi
# the optional X-Timezone header, kept in "$@" so it survives any shell
if [ -n "${VT_TIMEZONE:-}" ]; then set -- -H "X-Timezone: $VT_TIMEZONE"; else set --; fi

while :; do
  # one frame per cadence slot, sent at the start of the slot
  sleep $(( CADENCE - $(date +%s) % CADENCE ))
  if snapshot > "$RAW" &&
     ffmpeg -loglevel error -y -i "$RAW" -vf "scale=${WIDTH}:-2" -q:v 5 -f mjpeg "$FRAME"; then
    curl -sf --max-time 20 -o /dev/null -X POST "$VT_URL/upload" \
      -H "Authorization: Bearer $VT_TOKEN" \
      -H "X-Site: $VT_SITE" -H "X-Source: $VT_SOURCE" -H "X-Cadence: $CADENCE" \
      "$@" -H "Content-Type: image/jpeg" --data-binary "@$FRAME" ||
      echo "$(date '+%F %T') $VT_SOURCE: upload failed, frame dropped" >&2
  else
    echo "$(date '+%F %T') $VT_SOURCE: no snapshot, frame dropped" >&2
  fi
done
