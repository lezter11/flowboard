# Flowboard document scanner for a Linux host

The scanner receives private card attachments through a Unix socket. It runs document checks, ClamAV and PDF compression. ClamAV and the scanner have no network access. A separate FreshClam container downloads official signatures and has access only to the signature directory. The scanner requires the running ClamAV daemon to report signatures at most 48 hours old and to correctly classify a clean canary and the standard EICAR test file.

## Host setup

Use an always-on Linux host with Docker Engine, Compose v2 and enough memory for both the live ClamAV engine and an update to coexist. The configured combined container memory limits are about 6.4 GiB. An 8 GiB host is a starting point and must be checked with current signature files and the host's existing workloads. The host must keep accurate time. The updater needs access to the official [ClamAV signature distribution network](https://docs.clamav.net/manual/Usage/SignatureManagement.html).

From the repository root with Node 24 and workspace dependencies installed, build the scanner image.

```sh
npm ci
sh apps/api/src/runtime/document-scanner/build.sh
```

On the scanner host, initialize a dedicated directory and configuration. Run this as a host administrator. Use a different key for each environment, create it once, and install the same value as a secret in the corresponding API transport. Both services must stop accepting the old key when a planned rotation finishes.

```sh
export SCANNER_STATE_DIR=/var/lib/flowboard-document-scanner-uat
sudo install -d -o root -g 10004 -m 0710 "$SCANNER_STATE_DIR"
sudo install -d -o 10001 -g 10004 -m 2750 "$SCANNER_STATE_DIR/http"
sudo install -d -o 10002 -g 10003 -m 2750 "$SCANNER_STATE_DIR/antivirus"
sudo install -d -o 10002 -g 10003 -m 0750 "$SCANNER_STATE_DIR/definitions"
sudo sh -c '
  umask 077
  set -C
  openssl rand -hex 32 > "$1/scanner_key"
' sh "$SCANNER_STATE_DIR"
sudo chown 10001:10004 "$SCANNER_STATE_DIR/scanner_key"
docker compose -f apps/api/src/runtime/document-scanner/compose.yml up -d
```

For UAT, arrange a stable authenticated HTTPS route to the socket. A locally managed [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/concepts/routing/) can connect to a Unix socket on the host. Run the tunnel as a dedicated service identity with group access to the socket (GID 10004), restrict ingress to the scanner hostname and expected paths, and apply a service-token Access policy if choosing Cloudflare Access. Keep the scanner key private to the API transport and scanner. Disable caching and request body/header logging on the scanner route. The API transport must have a fixed HTTPS origin, refuse redirects and authenticate both layers when Access is in use. The deployment needs its own domain or hostname and an API transport configured for it. No tunnel, domain, or transport is provisioned by this package.

## Local readiness and test evidence

From the host, check the socket directly. The key stays out of shell arguments and output.

```sh
sudo sh -c '
  {
    printf "Authorization: Bearer "
    cat "$1/scanner_key"
  } | curl --silent --show-error --max-time 5 --unix-socket "$1/http/scanner.sock" \
    --header @- --output /dev/null --write-out "%{http_code}\n" http://localhost/ready
' sh "$SCANNER_STATE_DIR"
```

Expect `204` with the correct key and healthy signatures, `404` without the key, and `503` when ClamAV or current signatures are unavailable. Fresh provisioning can take several minutes for signature downloads and engine initialization. The containers restart if their main process exits. Monitor authenticated readiness separately so outages or stale signatures get attention even when processes remain running. Rebuild and retest the image for package updates. Keep the file upload feature disabled until hosted readiness and signed-in synthetic PDF, DOCX and XLSX checks pass.
