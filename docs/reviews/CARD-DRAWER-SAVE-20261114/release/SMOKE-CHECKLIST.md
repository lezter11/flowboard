# Signed-in release check

1. Open an untouched card, close it and click Projects. There should be no unsaved-changes warning. Open a comment editor without changing text, then close the card. Cancel a comment deletion with Escape and check the same behavior.
2. Post a test comment, attach a small PNG and change the status of a test card. Close without clicking Save changes. Reopen and verify the comment, photo and status. The board’s image count should update.
3. Edit the title without saving, close the card and choose Close and keep drafts. Reopen and confirm the title is still in the drawer. Discard the test draft.
4. Under Documents, add a named Google Drive link through Add link, then click Save changes. Reopen the card and click the link. Google applies the file’s sharing permissions. Remove the test link when finished.
5. Confirm the maintenance notice is visible while you test. Clearing the notice is a separate publication of the same production Pages build with `release-status.json` set to `{"active":false}`.
