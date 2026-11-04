# CI XLSX legal-boundary repair criteria

Recorded 2026-11-04 before parser source changes. Baseline bf047e085f50c2c74dfbd640dc01ca37f5ba4f8a; failed GitHub run 41685962254. Sensitive untrusted XML parsing. Builder does not approve or close backend features.

Scope: apps/api/src/services/import-xml.ts and excel-parser.ts; focused import tests and this evidence directory. No contracts, migrations, permissions, dependencies, hosted databases or deployment.

1. Preserve and reproduce the original 200-row, 20,000 escaped ampersands per description workbook through actual workerd. Profile decoding/preflight/validation/tree construction/entity conversion, decompression and total parse time before selecting the repair. Preserve failed attempts and exact command exits.
2. Keep every existing compressed/expanded/row/cell/entry/markup/depth/text/time limit unchanged. Do not remove the fixture, reduce its input or relax its assertions. Every description must equal its original text.
3. Preserve exactly-once entity decoding, literal entity-like text, rich text, CDATA, UTF8/UTF16 scalar/declaration checks, namespaces and package integrity. Malformed entities, invalid scalar values, DTD/ENTITY declarations, external relationships and dangerous package parts remain rejected.
4. Retain hostile near20MiB forests/large texts/deep XML rejection and subsequent isolate usability. Preserve blank template and real PostgreSQL preview/atomic commit behavior.
5. Run actual-workerd boundary and nearest parser/mounted import regressions, typecheck and API build. Record counts, skips, exits, fixture/source SHA-256 manifests and runtime. Local wall time is not hosted CPU/memory or Linux acceptance.
6. Independent review plus complete unchanged Linux candidate checks remain parent-owned gates. No self score, passing review or UAT claim from builder evidence.
