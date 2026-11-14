#!/bin/sh
set -eu
case "${1:-}" in
  scanner)
    # A restarted Node process can inherit a stale socket file after an unclean
    # shutdown. Keep the lock fd open for the lifetime of the replacement.
    umask 007
    exec 9>/run/flowboard-http/listener.lock
    flock -n 9
    if [ -S "$FB_DOCUMENT_HTTP_SOCKET" ]; then rm -- "$FB_DOCUMENT_HTTP_SOCKET"; fi
    exec node /opt/flowboard-scanner/scanner.cjs
    ;;
  antivirus)
    exec /usr/sbin/clamd --config-file=/opt/flowboard-scanner/clamd.conf
    ;;
  definitions)
    exec /usr/bin/freshclam --config-file=/opt/flowboard-scanner/freshclam.conf --daemon
    ;;
  *)
    exit 64
    ;;
esac
