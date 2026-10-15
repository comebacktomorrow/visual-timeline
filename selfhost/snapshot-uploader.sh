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
# the files below hold snapshots and the upload token: this user's only
umask 077

log() { echo "$(date '+%F %T') $*" >&2; }

# camera BACKEND SITE SOURCE TOKEN URL AUTH AUTH_TYPE TIMEZONE CADENCE WIDTH
# Runs one camera's loop, forever. Its files live in $tmp, the private folder
# made below.
camera() {
  backend=$1 site=$2 source=$3 token=$4 url=$5 auth=$6 auth_type=$7 tz=$8 cadence=$9 width=${10}
  raw="$tmp/$site-$source.raw"
  frame="$tmp/$site-$source.jpg"
  # the upload token and the camera's login reach curl through files, so
  # neither shows in ps; the login is a curl config line, " and \ escaped
  header="$tmp/$site-$source.header" login="$tmp/$site-$source.login"
  printf 'Authorization: Bearer %s\n' "$token" > "$header" &&
  printf 'user = "%s"\n' "$(printf '%s' "$auth" | sed 's/[\\"]/\\&/g')" > "$login" ||
    { log "$site/$source: can't write to $tmp; camera stopped"; return 1; }
  # the optional X-Timezone header, kept in "$@" so it survives any shell
  if [ -n "$tz" ]; then set -- -H "X-Timezone: $tz"; else set --; fi
  log "$site/$source: a frame every ${cadence}s"
  while :; do
    # one frame per cadence slot, sent at the start of the slot
    sleep $(( cadence - $(date +%s) % cadence ))
    if [ -z "$auth" ]; then
      curl -sf --max-time 10 --proto =http,https -o "$raw" "$url"
    else
      curl -sf --max-time 10 --proto =http,https "--$auth_type" -K "$login" -o "$raw" "$url"
    fi &&
    # the camera's bytes are read as an image and nothing else: no probing
    # them as a playlist or container that would make ffmpeg open more URLs
    ffmpeg -loglevel error -y -protocol_whitelist file -f image2pipe -i "$raw" \
      -vf "scale=$width:-2" -q:v 5 -f mjpeg "$frame" || {
      log "$site/$source: no snapshot, frame dropped"; continue; }
    curl -sf --max-time 20 -o /dev/null -X POST "$backend/upload" \
      -H "@$header" \
      -H "X-Site: $site" -H "X-Source: $source" -H "X-Cadence: $cadence" \
      "$@" -H "Content-Type: image/jpeg" --data-binary "@$frame" ||
      log "$site/$source: upload failed, frame dropped"
  done
}

# the backend's id rule: lowercase letters, digits, - and _, not starting with -
valid_id() {
  case $1 in ''|-*|*[!a-z0-9_-]*) return 1 ;; esac
}

# problem SITE ID URL AUTH_TYPE CADENCE WIDTH: why this camera can't run, or
# nothing if it can
problem() {
  valid_id "$1" && valid_id "$2" ||
    { echo "site and id must be lowercase letters, digits, - or _"; return; }
  # curl would also take file://, ftp:// and the rest
  case $3 in http://?*|https://?*) ;; *)
    echo "url must start with http:// or https://"; return ;; esac
  # it becomes curl's --digest or --basic
  case $4 in digest|basic) ;; *) echo "auth_type must be digest or basic"; return ;; esac
  for n in "$5" "$6"; do case $n in ''|*[!0-9]*)
    echo "cadence and width must be whole numbers"; return ;; esac; done
  [ "$5" -ge 5 ] && [ "$5" -le 3600 ] || echo "cadence must be 5 to 3600 seconds"
}

# one private folder for every camera's files, removed on the way out
tmp=$(mktemp -d "${TMPDIR:-/tmp}/vt-uploader.XXXXXX") ||
  { log "can't make a temporary folder"; exit 1; }
pids=''
stop() { [ -z "$pids" ] || kill $pids 2>/dev/null; exit 0; }
trap 'rm -rf "$tmp"' EXIT
trap stop INT TERM

if [ $# -eq 0 ]; then
  # one camera, from the environment
  : "${VT_URL:?}" "${VT_SITE:?}" "${VT_SOURCE:?}" "${VT_TOKEN:?}" "${SNAPSHOT_URL:?}"
  why=$(problem "$VT_SITE" "$VT_SOURCE" "$SNAPSHOT_URL" \
    "${SNAPSHOT_AUTH_TYPE:-digest}" "${CADENCE:-60}" "${WIDTH:-640}")
  [ -z "$why" ] || { log "$why"; exit 1; }
  camera "$VT_URL" "$VT_SITE" "$VT_SOURCE" "$VT_TOKEN" "$SNAPSHOT_URL" \
    "${SNAPSHOT_AUTH:-}" "${SNAPSHOT_AUTH_TYPE:-digest}" "${VT_TIMEZONE:-}" \
    "${CADENCE:-60}" "${WIDTH:-640}" &
  pids=$!
  wait
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

n=$(jq '.cameras | length' "$config")
i=0
while [ "$i" -lt "$n" ]; do
  site=$(jq -r --argjson i "$i" '.cameras[$i].site // ""' "$config")
  source=$(jq -r --argjson i "$i" '.cameras[$i].id // ""' "$config")
  url=$(jq -r --argjson i "$i" '.cameras[$i].url // ""' "$config")
  auth=$(jq -r --argjson i "$i" '.cameras[$i].auth // ""' "$config")
  tz=$(jq -r --argjson i "$i" '.cameras[$i].timezone // ""' "$config")
  auth_type=$(field "$i" auth_type digest)
  cadence=$(field "$i" cadence 60) width=$(field "$i" width 640)
  where="$config: camera ${source:-#$((i + 1))}"
  i=$((i + 1))
  why=$(problem "$site" "$source" "$url" "$auth_type" "$cadence" "$width")
  [ -z "$why" ] || { log "$where: $why; skipped"; continue; }
  token=$(printf '%s' "$UPLOAD_TOKENS" | jq -r --arg s "$site" '.[$s] // ""')
  [ -n "$token" ] || { log "$where: no upload token for site $site in UPLOAD_TOKENS; skipped"; continue; }
  camera "$backend" "$site" "$source" "$token" "$url" "$auth" \
    "$auth_type" "$tz" "$cadence" "$width" &
  pids="$pids $!"
done

[ -n "$pids" ] || { log "$config: no cameras to run"; exit 1; }
wait
