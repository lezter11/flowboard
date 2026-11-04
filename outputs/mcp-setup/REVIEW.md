# Independent local-helper review

Reviewed 2026-11-04. Scope: generated macOS Claude Desktop setup helper only. This is not a backend review-gate approval or verification of hosted MCP behavior.

Reviewed target SHA-256:

- `setup_claude.py`: `dbf05e2da6f73e1a9cf4de42e901c128e6605908802fc87c47a11e9a5ec4df4c`
- `test_setup_claude.py`: `4c07fb9f26806bf4d516e8450e656afc0bf45f44e8d2eef86b228f1e3124c7df`

No blocking code defect found within this narrow scope. Instructions must tell the user to quit Claude Desktop before running setup, retain the helper in its repository location, and execute the saved file with Python. Pasting its contents into Python stdin changes `__file__` and breaks repository-root discovery. Concurrent writes to the Claude config are not coordinated by this helper.

Observed protections: token shape is checked; no network calls or token output occur; other JSON settings and MCP entries are preserved; existing malformed or symlinked config is rejected; backups are private; replacement config has mode 0600; the replacement is atomic within the destination directory. The helper deliberately replaces an existing `flowboard-uat` entry, while retaining its prior bytes in the backup. Node requirements match the repository engines (`>=24.15.0 <25`).

Verification: independently ran `python3 outputs/mcp-setup/test_setup_claude.py` (5 tests, passing). An additional temporary-directory-only failure injection made `os.replace` raise: original config remained byte-identical, the backup remained, and temporary output was removed.

Limits: did not execute `main()`, inspect real Claude config, access real clipboard data, contact any service, build the MCP package, or verify Claude startup. Clipboard clearing and Node discovery were inspected in source only. Filesystem replacement does not coordinate with another process editing the same config, and these checks do not simulate power loss.
