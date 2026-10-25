# ADR 0003: Next.js frontend and a selective motion stack

Date: 2026-10-26. Status: user-directed proposal, pending scaffold and deployment spike. This record changes the frontend direction; it does not verify any product feature or prove the deployment model.

## Context

The user asked for Flowboard’s UI to use Next.js, Framer Motion, GSAP, Lenis, Locomotive and best-in-class frontend tooling, starting from a high-fidelity board/card-detail artifact. The existing architecture recommends React + Vite because board interaction dominates, the frontend is an authenticated app rather than a public content site, and static assets deploy simply alongside the Hono API on Cloudflare Workers.

Next.js is a real architectural change, not just a different folder name. It adds a server/runtime boundary, its own routing and caching model, and a deployment adapter. The decision must therefore record why it is being adopted, what it replaces, and what evidence is required before the root architecture is rewritten.

No `apps/web` application exists yet. The current design artifact under `design/flowboard-ui/` is dependency-free HTML/CSS/JavaScript and is not evidence that Next.js, the motion libraries or the production interactions work.

## Choice

Use **Next.js App Router with strict TypeScript** for `apps/web`, with these boundaries:

- The board route is a client component. It owns drag/drop, filters, drawer state and optimistic UI.
- Server components are used for the static shell, route metadata and other content that does not need browser state. They must not query PostgreSQL directly.
- The Hono API remains the only HTTP boundary for product data and authorization. Next.js route handlers are not a second business backend.
- The card drawer is URL-addressable (`?card=...` initially; an intercepting route can be evaluated later). Closing it must preserve board state and restore focus.
- Tailwind utilities plus CSS custom properties carry the design tokens. Light theme is the default; dark is a token variant.
- Radix/shadcn primitives provide dialogs, menus, tabs and focus management.
- **Framer Motion** handles enter/exit, presence and layout transitions where React state drives the animation.
- **GSAP** is reserved for a measured, complex sequence that CSS/Framer Motion handles poorly. It is not used for card drag, list reordering or routine hover/focus states.
- **Lenis** handles page-level smooth scrolling only. The board, columns and drawer keep native scrolling.
- **Locomotive Scroll is not used for the board.** It is transform-based, which complicates drag hit-testing, nested scrolling, keyboard focus and reduced-motion behavior.
- **dnd-kit** replaces the artifact’s native HTML5 drag events, with pointer, touch and keyboard sensors. The Move dialog remains the accessible alternative.
- TanStack Query owns server state and mutations; Zustand owns ephemeral UI state; React Hook Form + Zod own client form state and validation; Lucide supplies icons; Sonner supplies toasts; Playwright covers interaction and visual checks.

## Why and alternatives

### Next.js versus React + Vite

Next.js provides file-based routing, server components, built-in font/image handling and a large ecosystem. Those are useful for the public-facing parts of Flowboard and for a consistent app shell. The cost is a larger framework surface, a server/client boundary that must be taught and enforced, more deployment choices, and caching behavior that can be dangerous for private project data.

React + Vite remains the simpler option for an authenticated board: one static build, fewer runtime modes, and straightforward Worker static-asset hosting. Remix/React Router offers a comparable data-loading model with a smaller ecosystem fit. Astro is attractive for marketing/content pages but not for the board’s highly interactive surface. The user’s explicit direction selects Next.js; this ADR records the tradeoff rather than pretending it is free.

### Motion stack

Framer Motion is declarative and fits React-owned transitions such as drawer presence, dialog entry and card layout changes. It adds bundle weight, so simple color, border and transform changes stay in CSS. GSAP is more powerful for imperative timelines but can fight React’s ownership of the DOM; it should be introduced only after a concrete animation need and a performance measurement. Lenis improves the feel of long page scrolling but must not hijack the board or ignore `prefers-reduced-motion`. Locomotive Scroll is a heavier transform-based approach whose scrolling model conflicts with a nested drag surface.

### Data and state libraries

TanStack Query gives Flowboard one place for request caching, invalidation and optimistic mutation rollback. SWR is a lighter alternative; RTK Query is reasonable if the app adopts Redux, which Flowboard does not need for this scope. Zustand is a small store for drawer/filter/dialog state; Context or Redux would add ceremony without solving a current problem. React Hook Form + Zod keep validation close to the form while the API remains authoritative. None of these libraries replaces server-side permission checks.

## Consequences

- The frontend and API remain separate workspaces with separate build and test commands. Root scripts and CI must cover both.
- A hosting decision is required before calling the stack deployable:
  - **Node runtime** for Next.js, with the Hono API nearby; simplest server-component behavior, but adds a long-running compute service.
  - **OpenNext/Cloudflare adapter** on Workers; preserves the current hosting preference but adds adapter compatibility, bundle-size and cold-start risk.
  - **Static export** avoids a Next.js server but gives up server components, route handlers and some image/font features. It may be acceptable for the board if the shell is fully client-rendered, but it must be an explicit choice rather than an accident.
- Authenticated responses must be private/no-store. Next.js caching defaults must not be allowed to cache project data, comments or image metadata across users.
- Cookies, CSRF and same-origin API calls must be verified end to end. Next.js must not trust client-supplied identity or expose server secrets to the browser.
- The board’s client bundle grows. A performance budget and a measured board interaction check are required before adopting GSAP or additional animation code.
- Smooth scrolling and motion must be disabled or reduced under `prefers-reduced-motion`. Native scrolling remains the fallback.
- The existing `ARCHITECTURE.md` React + Vite statement is now stale. It should be reconciled only after the scaffold, deployment spike and performance evidence below; until then, readers should treat this ADR as the pending frontend decision and the architecture document as the previous baseline.
- If Next.js fails the deployment, privacy or interaction gate, the fallback is the existing React + Vite SPA. A new ADR would supersede this one rather than silently reverting.

## Gate before implementation commitment

1. Scaffold `apps/web` with Next.js App Router, strict TypeScript, Tailwind and the shared contracts package; `build`, `typecheck` and a Playwright smoke test must pass.
2. Choose and document the hosting mode (Node, OpenNext/Cloudflare or static export). Measure cold start, TTFB, client bundle size and a representative board interaction.
3. Verify same-origin auth/session cookies, CSRF behavior, private cache headers and API error handling. Confirm that no product data is fetched directly from PostgreSQL in a server component.
4. Port the artifact’s board shell, card drawer, Move dialog, comments and image states. Verify deep links, back/forward behavior, focus return, native board scrolling, reduced motion and mobile layout.
5. Record the results in `PROGRESS.md` and update `ARCHITECTURE.md`, `TASKS.md` and the engineering checklist only for what was actually demonstrated.

Until this gate passes, the Next.js stack is a recorded direction, not a verified implementation. The artifact remains design-only evidence.
