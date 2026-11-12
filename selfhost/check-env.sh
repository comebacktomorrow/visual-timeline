#!/bin/sh
# check-env.sh FILE NAME... -- COMMAND...: refuse to start while any NAME
# is missing, empty ('' and "" included, and an empty JSON map {}), or
# still holds the .env.example placeholder (a value containing
# "replace-with"), else run COMMAND. Compose's ${VAR:?} only catches an
# empty value, and a placeholder is a published secret. FILE is the env
# file to read NAMEs from (the backend's mounted selfhost/.env), or - for
# this process's environment (Grafana, which compose hands its values).
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

# empty NAME: is NAME missing or empty? From FILE, it is the value on NAME's
# last line as a dotenv reader takes it: surrounding quotes stripped, and an
# unquoted value's " # comment" dropped.
empty() {
  if [ "$file" = - ]; then
    v=$value
  else
    v=$(awk -v name="$1" '
      { sub(/^[ \t]+/, ""); sub(/^export[ \t]+/, "") }
      index($0, name) == 1 {
        rest = substr($0, length(name) + 1)
        if (rest !~ /^[ \t]*=/) next
        sub(/^[ \t]*=[ \t]*/, "", rest)
        sub(/[ \t\r]+$/, "", rest)
        q = substr(rest, 1, 1)
        if ((q == "\"" || q == "\047") && length(rest) >= 2 && substr(rest, length(rest), 1) == q)
          rest = substr(rest, 2, length(rest) - 2)
        else if (q == "#")
          rest = ""
        else
          sub(/[ \t]+#.*$/, "", rest)
        val = rest
      }
      END { printf "%s", val }' "$file")
  fi
  v=$(printf '%s' "$v" | tr -d ' \t\r\n')
  [ -z "$v" ] || [ "$v" = '{}' ]
}

bad=''
while [ $# -gt 0 ] && [ "$1" != -- ]; do
  eval "value=\${$1:-}"
  if empty "$1"; then
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
