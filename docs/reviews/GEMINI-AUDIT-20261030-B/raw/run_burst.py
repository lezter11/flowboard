import urllib.request, ssl, time, datetime

url = "https://flowboard-app-uat.pages.dev/api/v1/auth/google/start"
ctx = ssl.create_default_context()

class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = urllib.request.build_opener(NoRedirectHandler)

output_file = "docs/reviews/GEMINI-AUDIT-20261030-B/raw/uat-rate-limit-burst.tsv"

with open(output_file, "w") as out:
    out.write("req_num\ttimestamp\tstatus\telapsed_ms\tx_request_id\tnotes\n")
    print(f"Starting 40 requests burst to {url}...")
    for i in range(1, 41):
        t0 = time.time()
        now_iso = datetime.datetime.utcnow().isoformat() + "Z"
        status = None
        req_id = ""
        notes = ""
        req = urllib.request.Request(url, headers={"User-Agent": "FlowboardAuditBurst/1.0"})
        try:
            resp = opener.open(req)
            status = resp.status
            req_id = resp.headers.get("x-request-id", "")
        except urllib.error.HTTPError as e:
            status = e.code
            req_id = e.headers.get("x-request-id", "")
            notes = f"HTTPError {e.reason}"
        except Exception as ex:
            status = "ERR"
            notes = str(ex)
        elapsed_ms = int((time.time() - t0) * 1000)
        
        line = f"{i}\t{now_iso}\t{status}\t{elapsed_ms}\t{req_id}\t{notes}\n"
        out.write(line)
        out.flush()
        print(f"[{i}/40] status={status} elapsed={elapsed_ms}ms id={req_id} {notes}")
        
        if isinstance(status, int) and status >= 500:
            print(f"ABORTING burst: received 5xx status {status} on request {i}")
            break
        
        # Pace slightly over 60s window or fast burst? Prompt says "at most 40 requests to /api/v1/auth/google/start from one IP over 60s"
        # 40 requests across ~15-20s fits well within 60s
        time.sleep(0.3)

print("Burst test complete.")
