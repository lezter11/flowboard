#!/usr/bin/env bash
set +e
name="$1"
shift
root="$(cd "$(dirname "$0")" && pwd)"
out="$root/${name}.out"
log="$root/${name}.log"
{
  printf 'COMMAND:'
  printf ' %q' "$@"
  printf '\n'
  if [[ "$name" == db-* ]]; then printf 'DB CONTEXT: 127.0.0.1:55634; postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24\n'; fi
} > "$log"
cat "$log" >> "$root/commands.log"
"$@" 2>&1 | tee "$out"
rc=${PIPESTATUS[0]}
{
  printf '%s\n' 'OUTPUT:'
  cat "$out"
  printf 'EXIT CODE: %s\n\n' "$rc"
} | tee -a "$log" >> "$root/commands.log"
exit "$rc"
