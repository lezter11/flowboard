# Candidate B text chunking — source pre-review, not acceptance

Private fast-xml-parser5.11.2 candidate B adds the validator ASCII predicate from A plus one outer-text substitution in src/xmlparser/OrderedObjParser.js. Original ordered-parser SHAd1d5d64ecfb3df9b07ba3bd5ee020d166eaecbf569ebce67be692aa5892a21b5; B72f43cb7527e0575d3ae5024efd64c184bc31f93a2c1cafc7f62b7cc3b77f9f0. The examined diff changes only textData+=xmlData[i] into indexOf('<',i), bounded slice(i,end) and i=end-1. Main application/dependency source remains unchanged. No score, product fix, new parser API or hosted execution is approved.

## Index and side-effect argument

At the changed else branch, i<xmlLen and xmlData[i] is not '<'. The old loop repeatedly appends UTF16 units until the next '<' or EOF. There is no per-unit counter, callback, entity handling, parser-state mutation or limit check in that branch. Slicing the exact half-open interval yields the same JavaScript string value. Because the index is assigned end-1, the unchanged for increment lands at end, so a following '<' is processed rather than skipped. When no '<' remains, end=xmlLen and the loop exits at the same boundary. A zero-length run cannot occur for ordinary supported string input in this branch.

String.indexOf/slice use UTF16 offsets just like indexed access. Supplementary pairs and lone surrogate units remain the same text; the Flowboard fatal decoder/scalar preflight still independently controls admitted workbook text. CRLF normalization is done before xmlLen/index traversal in both versions, so existing normalized-source index semantics remain unchanged. Capture metadata start/end indexes are set only at the same markup boundaries.

The markup branch continues to handle opening/closing/self-closing/unpaired tags, comments, CDATA, processing instructions and DOCTYPE in its existing code. readStopNodeData has its separate unchanged traversal and jump behavior. Its return to the outer loop remains the same. saveTextToParentTag/parseTextData are invoked only at the same flush boundaries, with the same accumulated value, matcher state and options. Consequently entity expansion counters, tag-value processors and updateTag callbacks do not acquire new split/chunk boundaries. The candidate must retain the old tail behavior: it must not add a new end-of-file flush or correct malformed-input behavior as part of this optimization.

This reasoning assumes documented string/byte input and ordinary unmodified built-in String operations; malicious programmatic callers replacing JavaScript intrinsics are not an XML-input boundary and the existing parser already uses those built-ins elsewhere. No source-level semantic or security counterexample has been identified under the supported input model.

## Required differential evidence before judgment

Compare default, exact Flowboard options and selected generic options with preserveOrder on/off; processEntities on/off and bounded expansion; trim/parse values; captureMetaData; stopNodes; unpaired tags; comments/CDATA/PI declarations; transforms/updateTag/drop callbacks; whitespace/CRLF; malformed/truncated documents; no-markup/tail text; surrogate text; literal '&lt;' and entity-like text. Snapshot callback arguments at invocation, not retained mutable matcher references.

Metadata is stored under a Symbol and is invisible to JSON.stringify. Each package clone has its own metadata Symbol, so a valid differential must project XMLParser.getMetaDataSymbol() values into an explicit canonical field and compare actual offsets. Ignoring symbols would leave the principal source-index claim untested. Transport acknowledged this requirement before its differential execution.

No weakening of XMLValidator, its grammar/options, source scalar/structural preflights, DTD rejection, one-second total budget or maximum workbook assertions is part of B. Performance must be established by exact immutable mounted Worker/PostgreSQL fixtures and repeatable cold runs, with architecture/quota limitations stated. Candidate A's5/5 complete pressure passes plus one959ms cold maximum-only sample demonstrate why a narrow margin is not an exhaustive capacity guarantee; B has no approval until its own evidence is complete.

## Packaging and scope

If B proves worthwhile, it requires deterministic fail-closed governance for two exact pinned package files rather than A's one. ESM/CJS distinctions, upstream/patched hashes, MIT notice, full reviewed diffs, clean install verification and actual bundled-source proof remain required as detailed in DEPENDENCY-OPTIONS-PRE-REVIEW.md. CJS remains upstream in this private prototype and receives no performance claim. The two tiny source substitutions preserve much more of the existing grammar/adapter than a SAX rewrite, while creating an explicit obligation to revisit both files at upstream updates. This tradeoff is conditional, not a license to accumulate further patches without new evidence.
