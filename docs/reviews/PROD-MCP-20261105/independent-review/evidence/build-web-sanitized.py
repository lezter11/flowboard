import os,subprocess
env={k:os.environ[k] for k in ("HOME","PATH","TMPDIR","LANG","SSL_CERT_FILE","SSL_CERT_DIR") if k in os.environ}
env.update(NODE_ENV="production",NEXT_EXPORT="true",NODE_OPTIONS="--dns-result-order=ipv4first")
print("Sanitized local static build; allowed environment names:",sorted(env),flush=True)
raise SystemExit(subprocess.call(["npm","run","build:web"],env=env))
