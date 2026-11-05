'use client';

import { useRef, useState } from 'react';

const CARD_PROMPT = `Create exactly one card using my connected Flowboard project.

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
If creation times out or its outcome is unclear, reuse the same operation ID and unchanged input when retrying; do not create a second card.`;

export function McpPromptHelp() {
  const [notice, setNotice] = useState('');
  const prompt = useRef<HTMLTextAreaElement>(null);
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(CARD_PROMPT);
      setNotice('Prompt copied. Replace the bracketed details before sending it to your AI app.');
    } catch {
      prompt.current?.focus();
      prompt.current?.select();
      setNotice('Copy was blocked. The prompt is selected; copy it manually.');
    }
  };

  return <details className="connection-prompt">
    <summary>Create a card from your AI app</summary>
    <p className="field-help" id="cardPromptHelp">Browser sign-in currently supports Claude. Connect Flowboard in Claude, then paste this prompt. Use it in another AI app only if that app already has a working, supported Flowboard connection. Replace the bracketed details and remove optional lines you do not need.</p>
    <p className="field-help"><strong>Required:</strong> a title and a clear board and column/status in your approved project. Include the project name to avoid confusion. The AI looks up the IDs for you.</p>
    <p className="field-help"><strong>Optional:</strong> description, priority (None, Low, Medium, High or Urgent) and due date (YYYY-MM-DD). Without them, the card has an empty description, no priority and no due date.</p>
    <p className="field-help"><strong>Assignment:</strong> the connector creates unassigned cards. Open the card in Flowboard to assign a teammate afterward. Naming someone in the prompt does not assign them or grant access.</p>
    <div className="field"><label className="field-label" htmlFor="cardPrompt">Sample card prompt</label><textarea className="control connection-prompt-text" id="cardPrompt" ref={prompt} readOnly value={CARD_PROMPT} aria-describedby="cardPromptHelp" rows={13} spellCheck={false} /></div>
    <button className="btn" type="button" onClick={() => void copyPrompt()}>Copy sample prompt</button>
    <p className="field-help" role="status" aria-live="polite">{notice}</p>
  </details>;
}
