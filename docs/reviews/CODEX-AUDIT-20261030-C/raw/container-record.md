# Disposable database record

- Container: `codex-flowboard-audit-20261030-c`
- Image: `postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`
- Port binding: `127.0.0.1:55634:5432` (not 55432, 55479, or 55633)
- Data directory: container tmpfs, 1 GiB maximum
- Databases: `flowaudit`, `flowaudit0010`
- Start output/container ID: `raw/docker-run.out`; creation succeeded (the container was confirmed running by subsequent database connections and version query).
- Stop/remove: `docker rm -f codex-flowboard-audit-20261030-c`, exit 0, `raw/db-cleanup.log`.
- Elevated post-cleanup check: `docker ps -a --filter name=codex-flowboard-audit-20261030-c --format '{{.Names}}'`, exit 0 with no output, `raw/db-cleanup-verify.log`.

All DB command captures named `db-*` state this same endpoint and pinned image digest in their `.log`.

