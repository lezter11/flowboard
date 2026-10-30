# Owner Action & Authenticated UAT Verification Checklist

**Target Commit:** `8cc31e26065b3351b68296a48163778744bd2f6c`  
**Target UAT Environment:** `https://flowboard-app-uat.pages.dev`  
**Date:** 2026-10-30  

Per ground rule 4, the independent audit executed only unauthenticated requests against the deployed UAT environment. The following items require real credentials, external service permissions, or authenticated browser interactions that must be performed by the project owner.

---

## 1. Cloudflare Worker Environment Secrets & Bindings Check
Before authenticated flows will succeed on UAT or Production, verify the following variables and bindings in the Cloudflare Dashboard (`Workers & Pages` > `flowboard-api-uat` > `Settings` > `Variables and Secrets`):

1. **`GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`**:
   - `GOOGLE_CLIENT_ID`: `837833140429-i4247indpdtapgdhlddfk2p53eun6uhh.apps.googleusercontent.com`
   - `GOOGLE_CLIENT_SECRET`: Verify client secret matches the Google Cloud Console credentials.
   - Authorized Redirect URIs in Google Cloud Console must include:
     `https://flowboard-app-uat.pages.dev/api/v1/auth/google/callback`
2. **`SESSION_SECRET`**:
   - High-entropy cryptographic random string (at least 32 bytes) used for HMAC token verification.
3. **`ADMIN_SECRET`**:
   - Shared secret required for `/api/v1/system/status` and `/api/v1/system/migrate`.
4. **`BREVO_API_KEY`**:
   - API key (`xkeysib-...`) for outbound invitation emails.
   - Sender address must match the verified Brevo sender domain.
5. **`IMAGES` R2 Bucket Binding**:
   - The private R2 bucket must be bound directly as `IMAGES`.
   - *Audit Check Note:* Without this binding, image endpoints return HTTP 503 `CONFIG_ERROR`. Confirm `IMAGES` is bound.
6. **`DATABASE_URL` / `HYPERDRIVE`**:
   - Connection string to the target Neon PostgreSQL branch.

---

## 2. Authenticated UAT Live Smoke Test (Step-by-Step)

### Step A: Google Sign-In & Session Persistence
1. In an incognito browser window, open `https://flowboard-app-uat.pages.dev/signin`.
2. Click **"Sign in with Google"**.
3. Authenticate with your authorized Google account.
4. Verify you are redirected to `https://flowboard-app-uat.pages.dev/projects`.
5. Open DevTools > Application > Cookies:
   - Confirm cookie `flowboard_session` exists.
   - Confirm flags: `HttpOnly`, `Secure`, `SameSite=Lax`.

### Step B: Board Creation & Access Isolation
1. Create a project named `Beta Test Project`.
2. Create two boards: `Board Alpha` and `Board Beta`.
3. In `Board Alpha`, create 3 columns and add a card titled `Task 1`.
4. Move `Task 1` from the first column to the second column using both drag-and-drop and the keyboard Move dialog (`m` / Move button).

### Step C: Member Invitation & Outbox Delivery
1. Click **"Invite people"** on `Beta Test Project`.
2. Enter a secondary test email address as `Member`.
3. Click **"Send invitation"**.
4. Check the inbox of the invited test email address:
   - Verify delivery of the styled Plum-themed email from Flowboard.
   - Verify the invite link has the format `https://flowboard-app-uat.pages.dev/invitation?token=<token>`.
5. In a separate browser profile/incognito session, open the invitation link while signed into the secondary Google account.
6. Accept the invitation.
7. Confirm that initially, the invited member sees **0 boards** (as required by the per-board access grant model).

### Step D: Per-Board Access Grant Verification
1. As the Owner, navigate to `/people` > **"Board access"**.
2. Grant the invited member access to `Board Alpha` only (leave `Board Beta` ungranted).
3. Switch back to the invited member's browser session:
   - Verify `Board Alpha` appears in the member's project navigation.
   - Verify `Board Beta` does NOT appear.
   - Attempting to load `https://flowboard-app-uat.pages.dev/board?id=<board-beta-id>` must return 404 with no project metadata leakage.

### Step E: Private Image Upload & Optimization
1. In `Board Alpha`, open `Task 1` detail drawer.
2. Upload a camera photo or screenshot (> 500 KB, JPEG or PNG).
3. Observe client-side preparation:
   - Verify the note indicates `Optimised X KB → Y KB`.
   - Verify the thumbnail appears in the card gallery.
4. Click the thumbnail to open the Lightbox viewer:
   - Confirm full-size display and download link.
5. In an unauthenticated window, copy the image URL (`/api/v1/images/<id>/content`) and verify it returns HTTP 401 Unauthorized.

---

## 3. Production Deployment Approval
- Automated checks and unauthenticated UAT scans passed.
- Deployment chat holds the production deployment runbook and rollback identifiers.
- Await owner's explicit confirmation before cutover.
