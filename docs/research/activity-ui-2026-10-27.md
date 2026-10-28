# Activity design — 27 October 2026

The Activity preview uses a chronological timeline, project/person/action/date filters and a concise result count. Event icons and labels use the existing Flowboard palette, with reduced-motion support. It uses native page scrolling with smooth programmatic scrolling rather than a nested scrolling library.

The preview collects card history only from locally accessible projects and boards and links each card event to its source board. Sample project administration events are shown to preview roles allowed to manage projects. This is synthetic local behavior, not proof of server authorization or a durable audit log.

Not all sample cards have recorded activity. Board-specific events whose source board cannot be determined are omitted rather than attributed to a guessed board. The preview therefore does not represent a complete history.

For real data, Activity requires verified backend contracts, access checks, bounded pagination and integrated testing. A concise live result count follows the intent of [WCAG status message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
