# Explicit priority at frontend creation

User request, 27 October 2026: priority is mandatory whenever creating a card in the frontend.

Decision: require an explicit Low, Medium, High or Urgent selection; show a blank placeholder rather than guessing Medium. Apply the rule to board quick-add, the full Add Card form and the local sample import path. Block invalid submission and preserve typed content. Keep existing cards with none readable/editable.

A default selection would save one interaction but could misrepresent intent; requiring a choice provides clear new-card categorization. The curated four-value validation also rejects unknown values. This UI validation improves feedback but cannot enforce API writes from other clients. Existing backend contracts and workbook template still allow none; their migration needs a separately coordinated backend/import change and review. No backend files, contracts, migrations or accepted handoffs change here.

Evidence: source/mock-DOM tests and independent bounded review documented in design/flowboard-ui/reviews/board-followup-2026-10-27.md. No browser rendering or real XLSX parser verification.
