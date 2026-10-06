#!/bin/sh
# Post camera snapshots to a Visual Timeline backend, one frame per cadence.
#
# Almost every IP camera and NVR has a snapshot URL, for example:
#   Hikvision  http://CAMERA/ISAPI/Streaming/channels/101/picture
#   Dahua      http://CAMERA/cgi-bin/snapshot.cgi
#   Axis       http://CAMERA/axis-cgi/jpg/image.cgi
#   Frigate    http://FRIGATE:5000/api/CAMERA_NAME/latest.jpg
# (ONVIF cameras advertise theirs through GetSnapshotUri.)
#
# Many cameras: give it a JSON file (the format is in cameras.example.json).
# Upload tokens come from UPLOAD_TOKENS, the same {"site": "token"} map the
# backend uses, so the camera file never holds them. Needs jq.
#   UPLOAD_TOKENS='{"home": "..."}' sh snapshot-uploader.sh cameras.json
#
# One camera: environment variables only.
#   VT_URL=http://localhost:8787 VT_SITE=home VT_SOURCE=driveway \
#   VT_TOKEN=<the site's upload token> \
#   SNAPSHOT_URL=http://camera.lan/cgi-bin/snapshot.cgi \
#   SNAPSHOT_AUTH=user:password \
#   sh snapshot-uploader.sh
#   Optional: CADENCE (seconds, default 60), WIDTH (default 640),
#   VT_TIMEZONE (an IANA name such as Australia/Brisbane, if the camera burns
#   a clock into the image), SNAPSHOT_AUTH_TYPE (digest, the default, or
#   basic; it becomes curl's --digest or --basic).
#
# Needs curl and ffmpeg. Each camera runs on its own schedule, so a slow or
# dead camera never delays the others. A failed snapshot or upload is
# dropped, never retried: the gap on the timeline is how a dead camera shows
# up.

set -u

log() { echo "$(date '+%F %T') $*" >&2; }

# camera BACKEND SITE SOURCE TOKEN URL AUTH AUTH_TYPE TIMEZONE CADENCE WIDTH
# Runs one camera's loop, forever.
camera() {
  backend=$1 site=$2 source=$3 token=$4 url=$5 auth=$6 auth_type=$7 tz=$8 cadence=$9 width=${10}
  raw="${TMPDIR:-/tmp}/vt-$site-$source.raw"
  frame="${TMPDIR:-/tmp}/vt-$site-$source.jpg"
  # the optional X-Timezone header, kept in "$@" so it survives any shell
  if [ -n "$tz" ]; then set -- -H "X-Timezone: $tz"; else set --; fi
  log "$site/$source: a frame every ${cadence}s"
  while :; do
    # one frame per cadence slot, sent at the start of the slot
    sleep $(( cadence - $(date +%s) % cadence ))
    if [ -z "$auth" ]; then
      curl -sf --max-time 10 -o "$raw" "$url"
    else
      curl -sf --max-time 10 "--$auth_type" -u "$auth" -o "$raw" "$url"
    fi &&
    ffmpeg -loglevel error -y -i "$raw" -vf "scale=$width:-2" -q:v 5 -f mjpeg "$frame" || {
      log "$site/$source: no snapshot, frame dropped"; continue; }
    curl -sf --max-time 20 -o /dev/null -X POST "$backend/upload" \
      -H "Authorization: Bearer $token" \
      -H "X-Site: $site" -H "X-Source: $source" -H "X-Cadence: $cadence" \
      "$@" -H "Content-Type: image/jpeg" --data-binary "@$frame" ||
      log "$site/$source: upload failed, frame dropped"
  done
}

# the backend's id rule: lowercase letters, digits, - and _, not starting with -
valid_id() {
  case $1 in ''|-*|*[!a-z0-9_-]*) return 1 ;; esac
}

if [ $# -eq 0 ]; then
  # one camera, from the environment
  : "${VT_URL:?}" "${VT_SITE:?}" "${VT_SOURCE:?}" "${VT_TOKEN:?}" "${SNAPSHOT_URL:?}"
  camera "$VT_URL" "$VT_SITE" "$VT_SOURCE" "$VT_TOKEN" "$SNAPSHOT_URL" \
    "${SNAPSHOT_AUTH:-}" "${SNAPSHOT_AUTH_TYPE:-digest}" "${VT_TIMEZONE:-}" \
    "${CADENCE:-60}" "${WIDTH:-640}"
  exit
fi

# many cameras, from a JSON file
config=$1
command -v jq >/dev/null || { log "jq is needed to read $config"; exit 1; }
jq -e '.cameras | type == "array"' "$config" >/dev/null 2>&1 ||
  { log "$config: not JSON with a \"cameras\" array (see cameras.example.json)"; exit 1; }
[ -n "${UPLOAD_TOKENS:-}" ] ||
  { log "set UPLOAD_TOKENS, the same {\"site\": \"token\"} map the backend uses"; exit 1; }
printf '%s' "$UPLOAD_TOKENS" | jq -e 'type == "object"' >/dev/null 2>&1 ||
  { log "UPLOAD_TOKENS is not a JSON {\"site\": \"token\"} map"; exit 1; }
backend=${VT_URL:-$(jq -r '.backend // ""' "$config")}
[ -n "$backend" ] || { log "$config: set \"backend\", or VT_URL"; exit 1; }

# field I NAME DEFAULT: camera I's NAME, else the file's top-level NAME, else DEFAULT
field() {
  jq -r --argjson i "$1" --arg k "$2" --arg d "$3" \
    '.cameras[$i][$k] // .[$k] // $d | tostring' "$config"
}

pids=''
stop() { [ -z "$pids" ] || kill $pids 2>/dev/null; exit 0; }
trap stop INT TERM

n=$(jq '.cameras | length' "$config")
i=0
while [ "$i" -lt "$n" ]; do
  site=$(jq -r --argjson i "$i" '.cameras[$i].site // ""' "$config")
  source=$(jq -r --argjson i "$i" '.cameras[$i].id // ""' "$config")
  url=$(jq -r --argjson i "$i" '.cameras[$i].url // ""' "$config")
  auth=$(jq -r --argjson i "$i" '.cameras[$i].auth // ""' "$config")
  tz=$(jq -r --argjson i "$i" '.cameras[$i].timezone // ""' "$config")
  where="$config: camera ${source:-#$((i + 1))}"
  i=$((i + 1))
  if ! valid_id "$site" || ! valid_id "$source"; then
    log "$where: site and id must be lowercase letters, digits, - or _; skipped"; continue
  fi
  [ -n "$url" ] || { log "$where: no url; skipped"; continue; }
  token=$(printf '%s' "$UPLOAD_TOKENS" | jq -r --arg s "$site" '.[$s] // ""')
  [ -n "$token" ] || { log "$where: no upload token for site $site in UPLOAD_TOKENS; skipped"; continue; }
  cadence=$(field $((i - 1)) cadence 60) width=$(field $((i - 1)) width 640)
  case $cadence$width in *[!0-9]*)
    log "$where: cadence and width must be whole numbers; skipped"; continue ;; esac
  if [ "$cadence" -lt 5 ] || [ "$cadence" -gt 3600 ]; then
    log "$where: cadence must be 5 to 3600 seconds; skipped"; continue
  fi
  camera "$backend" "$site" "$source" "$token" "$url" "$auth" \
    "$(field $((i - 1)) auth_type digest)" "$tz" "$cadence" "$width" &
  pids="$pids $!"
done

[ -n "$pids" ] || { log "$config: no cameras to run"; exit 1; }
wait
