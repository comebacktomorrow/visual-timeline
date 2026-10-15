#!/bin/sh
# check-env.sh FILE NAME... -- COMMAND...: refuse to start while any NAME
# still holds the .env.example placeholder (a value containing
# "replace-with"), else run COMMAND. Compose's ${VAR:?} only catches an empty
# value, and a placeholder is a published secret. FILE is the env file to
# read NAMEs from (the backend's mounted selfhost/.env), or - for this
# process's environment (Grafana, which compose hands its values), where an
# empty NAME is refused too.
#   check-env.sh /config/vt.env UPLOAD_TOKENS VIEWER_TOKEN -- npx wrangler dev
#   check-env.sh - GF_SECURITY_ADMIN_PASSWORD -- /run.sh

set -u
file=$1; shift

# placeholder NAME: is NAME still the placeholder?
placeholder() {
  if [ "$file" = - ]; then
    case $value in *replace-with*) return 0 ;; esac
    return 1
  fi
  # NAME=..., optionally after "export", with the placeholder anywhere in it
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=.*replace-with" "$file"
}

bad=''
while [ $# -gt 0 ] && [ "$1" != -- ]; do
  eval "value=\${$1:-}"
  if [ "$file" = - ] && [ -z "$value" ]; then
    echo "selfhost/.env: set $1" >&2
    bad=1
  elif placeholder "$1"; then
    echo "selfhost/.env: $1 is still the .env.example placeholder; set a real value (openssl rand -hex 24 makes one)" >&2
    bad=1
  fi
  shift
done
[ -z "$bad" ] || exit 1
[ $# -eq 0 ] || shift
exec "$@"
