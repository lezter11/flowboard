# Flowboard in Claude: production connection setup

**Promotion is currently rolled back after CPU-limit failures. These setup steps are for the next approved production release; do not retry production yet.** The existing hosted UAT connector remains separate. [Current incident](reviews/PROD-MCP-20261105/CPU-INCIDENT.md).

No Terminal, API token, client secret or local server is needed. Hosted browser sign-in currently supports **Claude**. Production uses its own connection, users, projects and data; a UAT approval does not connect you to production.

## Connect and run a small owner test

1. In Claude, open **Customize → Connectors → + Add → Add custom connector**. Name it **Flowboard Production** and enter:

   `https://flowboard-app.pages.dev/api/v1/mcp`

2. Choose **Sign in now**. Leave manually supplied client credentials and request headers empty. If Claude asks which OAuth client to use, choose **Register automatically**. Sign in through Google with your production Flowboard account, choose one production project and approve access.
3. Start a new Claude chat and enable **only Flowboard Production** for this test. Ask:

   > Use Flowboard Production to show the boards and columns I can access in my approved project. Do not create anything yet.

4. Choose a board and column from that result where you are permitted to create a synthetic test card. Ask:

   > Create exactly one synthetic card titled "Production connector smoke test" in board [board name], column [column name]. Ask me if the destination is unclear. Do not use real customer or private business details.

   Open that board in [Flowboard Production](https://flowboard-app.pages.dev) and verify exactly one card appears. Ask Claude to search for that exact title. This step writes one test card to production; use a clearly designated test destination.
5. In production Flowboard, open **Settings → Connections** and disconnect **this production connection**. Ask Claude to make a new Flowboard Production tool call. It must require reconnecting or return an authorization error. A response repeated from chat memory is not proof of disconnection. Reconnect when you want to use the integration again.

Keep the UAT connector disabled during this test so a successful UAT call cannot be mistaken for production acceptance. For Claude Team/Enterprise, the Claude organization owner adds the connector once; colleagues connect with their own production Flowboard accounts. See the [official Claude custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) for current interface labels and organization requirements.

## Copy a card prompt

In Flowboard, open **Settings → Connections → Create a card from your AI app** and choose **Copy sample prompt**, or copy the text below. Replace bracketed details and remove optional lines you do not need.

```text
Create exactly one card using my connected Flowboard project.

Project: [approved project name]
Board: [board name]
Column/status: [column name]
Title: [short card title]
Priority: High
Due date: [YYYY-MM-DD, or remove this line]
Assignment: [teammate name, or remove this line; I will assign them in Flowboard]
Description: [details, or remove this line]

First look up the boards and columns I can access. Ask me if the destination or title is missing or ambiguous; do not guess. Use the exact board and column IDs you find.
The connector cannot set assignees yet. Create the card unassigned and remind me to assign it in Flowboard if I requested an assignment. Do not claim it was assigned.
If creation times out or its outcome is unclear, reuse the same operation ID and unchanged input when retrying; do not create a second card.
```

**Required:** a title and an unambiguous board and column/status within your approved project. Include the project name to avoid confusion. The AI resolves permitted board/column IDs and generates the operation identifier used to prevent duplicate retries; you do not need to find those identifiers yourself.

**Optional:** description, priority (`None`, `Low`, `Medium`, `High` or `Urgent`) and a real calendar due date in `YYYY-MM-DD` format. Omitted values mean an empty description, no priority and no due date. Dates have no time or timezone.

**Assignment is manual:** the MCP create tool creates an unassigned card. Open the card in Flowboard afterward to assign an eligible teammate. Naming someone in a prompt or description does not assign them or grant access.

## Current limits

The connector discovers permitted projects, boards and columns, searches cards and creates cards. Each connection approves one project; current membership, role and board grants are checked on every call. Naming a different project or board never grants access.

This integration does not set assignees, update existing cards, add comments or upload images. Company machine-to-machine client credentials are separate future work. Hosted browser sign-in supports Claude; reuse the prompt in another AI app only if it already has its own supported, working Flowboard connection, such as the separate existing local integration. Adding the hosted URL alone does not enable other AI apps.

If a step fails, report the step, approximate time and visible safe error. Do not share callback URLs, cookies, authorization codes, tokens or client secrets.
