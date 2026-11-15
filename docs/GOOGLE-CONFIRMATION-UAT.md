# Test optional Google confirmation in UAT

Use [Flowboard UAT](https://flowboard-app-uat.pages.dev) and a test board.

1. Sign out and sign back in with your usual UAT Google account. Open an existing board and move a test card. The board and edit should work immediately.
2. Open **Settings → Account**. If **Confirm Google sign-in** is offered, you can skip it and continue working. To test confirmation, use a separate existing trusted session, complete the Google chooser with the same account, then verify that the usual projects still open. A new account signed in through Google may already show as confirmed.
3. In Claude, use the UAT connector at `https://flowboard-app-uat.pages.dev/api/v1/mcp`. Pick the test project on the Flowboard consent page. Ask Claude to list boards in that project, then create a card named `UAT Google confirmation smoke` on a named board and column. Check the card in Flowboard. When practical, also ask Claude for a board outside the selected project and confirm that it cannot access it.
4. If you have a UAT API token minted from a trusted session, confirm it still works against the board it was given access to. Keep tokens and callback URLs private.

The automated PostgreSQL tests cover the legacy recovery case with synthetic accounts. They check that a token or Claude connection issued through email-only sign-in works while the account is unconfirmed and loses access when an existing trusted session confirms the account. A fresh UAT database may have no eligible legacy account to reproduce this through the UI.
