# Independent import reviewer identity and boundary

Allocated canonical task: `/root/formal_import_round1`.
Reviewer actor: `formal-import-round1-independent-reviewer`.
Reviewer session identity: `/root/formal_import_round1`, a fresh delegated agent context. Provider UUID and a separately exposed model ID are unavailable; neither is invented. Model is the inherited parent model.

I did not implement the target. I reviewed source, criteria and preserved builder evidence read-only and wrote only this new review directory. I did not edit applications, migrations, shared contracts, criteria, runtime configuration, original tests or original fixtures. The held target has611files and source manifest digest`27db43d94d3a45bfea41b6d8e3cffba3e07bb6118e0c0b08437ab5b7c011910b`. My complete initial hash check matched all611files.

I apply the code-review-and-quality skill to correctness, security, maintainability and verification. Its mutation-test suggestion is inapplicable to this explicitly read-only immutable review; I instead generated new CRC-valid adversarial XLSX files in this review directory and exercised the real mounted API and PostgreSQL. A first sandboxed local-DB attempt failed EPERM and is preserved. The approved rerun used only the authorized loopback PostgreSQL17harness on55931, synthetic test identities and an automatically cleaned random schema. It did not call any hosted URL, mail, provider or storage service. External-looking URLs in attack fixtures are inert content and no network fetch is claimed.

I issued `mounted-probes.test.ts` and `followup-probes.test.ts` commands myself. Their passing test counters mean only that the observation harness ran and recorded outcomes; they DO NOT mean the product passed the expected acceptance criteria. Concrete returned values below show mandatory defects. Builder/root gates and the separately delegated executor's full gates, if later consumed, will retain explicit attribution. I will not claim to have issued those commands.

This is a local feature acceptance review, coveringIMP01–11and reachable auth/grant/lifecycle/receipt/outbox/retention, API/parser/template/contracts/migrations and UI dependencies. Google OAuth, realR2/storage policies, hosted cron effectiveness and hosted CPU/load remain UAT pending. Those exclusions do not waive discovered local mandatory defects.
