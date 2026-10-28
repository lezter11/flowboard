# My tasks design research — 27 October 2026

## Direction

My tasks is a personal queue grouped by overdue, today, the next seven days, later and no due date. Each row links to its source board and identifies the project, board, workflow stage, priority and due date. The overview shortcuts use the same date filters as the queue. Completed tasks are separately expandable. The prototype uses the existing palette and keeps strong attention cues for overdue tasks, with reduced motion respected.

## Decisions

- Native select controls provide familiar keyboard and touch behavior without building a custom listbox. See [W3C's combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).
- Use normal document scrolling instead of a nested smooth-scroll container, so task navigation remains predictable. Longer real lists may need bounded pagination after measurement.
- Put a concise result count in a live region rather than announcing the entire list on every search change. See [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
- Use visible labels as well as color for due and priority states; keep hover animation optional under reduced motion. See [WCAG use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) and [animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).
- Search stays in the current page, rather than writing potentially sensitive task text to the URL. Project, priority, due and completed filters remain shareable preview parameters.

## Limits

This is an HTML design preview using synthetic, access-filtered portfolio data. It does not implement server authentication, authorization, real assignment queries, pagination or production persistence. A task is edited or completed on its source board; no write is performed from My tasks. API and integrated acceptance require their own verified contracts and evidence.
