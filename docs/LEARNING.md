# Flowboard: the stack in simple English

Updated 2026-10-26. This is the proposed stack, not a running or benchmarked application. A tech stack is the collection of tools used to build and run an app. Each tool has a different job.

## Start with one card move

1. React displays a card and lets you drag it into Testing.
2. The browser sends a request to our backend: move this card, using the version I last saw.
3. Cloudflare Workers runs the backend code; Hono directs the request to the move handler.
4. Authentication identifies the user; Flowboard checks whether that user may edit this board.
5. Kysely helps construct the database query; pg sends it through the Worker connection adapter/Hyperdrive to PostgreSQL hosted by Neon.
6. PostgreSQL checks versions and relationships, then saves the card, history and notification intent together in a transaction—or rolls them back together.
7. The API returns the saved version. React confirms it, or restores/explains a failed move. Notifications can be delivered afterwards through durable background work.

TypeScript helps check our code while we develop. Vite runs the frontend development server and builds the browser files. GitHub stores code history and can run automated checks. Those tools are not extra steps inside every card move.

## The main tools

| Tool | What it does | What it is good at | Main downside |
|---|---|---|---|
| React | Builds the visible interface from reusable pieces | Cards, columns, dialogs and interactive updates | We must manage state, accessibility and rendering carefully; React alone does not save data |
| TypeScript | Adds type checking to JavaScript | Catching mismatched values before running the app; sharing expected data shapes | More learning/setup; outside inputs still need runtime validation |
| Vite | Development server and frontend build tool | Quick local feedback and packaging browser files for hosting | It does not supply our database, permissions or complete backend architecture |
| Hono | Organizes backend URLs and request handlers | Small HTTP layer, middleware, Worker and Node deployment options | We still implement business rules, database access and authorization; a small router does not guarantee a fast app |
| PostgreSQL / Postgres | Stores and queries durable structured data | Related users/cards/comments, rules, indexed queries and all-or-nothing transactions | Needs query/index/connection care and recovery operations; a busy shared writer can bottleneck |
| Neon | Hosts PostgreSQL for us | Avoids operating our own database machine during the pilot | Provider quotas, regions, billing and idle-resume behavior still matter |
| Cloudflare Workers | Runs our backend without managing a traditional server | Managed deployment/ingress and static asset delivery | Runtime/resource limits and cloud-specific APIs; database round trips still take time |
| Hyperdrive | Manages/reuses database connections from Workers | Reduces repeated connection setup overhead | Cloudflare-specific; cannot fix slow SQL; query cache must be disabled for our fresh board/auth reads |
| Kysely + pg | Kysely helps write typed SQL queries; pg talks to PostgreSQL | Keeps query intent and transactions visible with type assistance | Extra libraries; SQL, indexing and same-connection transactions still require understanding |
| Better Auth (candidate) | Handles login identities and sessions | Avoids inventing authentication machinery from scratch | Configuration, patching and runtime compatibility remain our responsibility; Flowboard still owns board permissions |
| Node.js (second runtime) | Runs JavaScript on a normal server or local machine | Gives the backend another execution target, useful for AWS/Azure containers and local testing | Server sizing, lifecycle, connections and hosting differ from Workers |
| GitHub | Stores code and its change history; supports review/checks | Collaboration, pull requests and automated validation/deployment workflows | Repository access/secrets need configuration; GitHub is not our app database |

## Three distinctions to remember

**PostgreSQL vs Neon:** PostgreSQL is the database software; Neon is a host running it. Moving compatible PostgreSQL data to another host is different from changing to a different database engine.

**Hono vs Workers vs Node:** Hono organizes how requests are handled. Workers and Node are places/environments that execute that code. Sharing Hono/domain code helps portability, but networking, deployment and resource behavior still need separate tests.

**Login vs permission:** Knowing that a user is Shubham does not prove Shubham may edit every board. Authentication identifies the user; authorization checks allowed actions in the particular workspace.

## Why these choices

### Monolith, modular monolith and microservices

A monolith packages the main backend as one application. A modular monolith keeps that application organized into clear modules—accounts/permissions, boards/cards, comments and notification jobs—rather than mixing every feature together. Modules call one another inside the application and can share a database transaction.

For Flowboard, moving a card checks permission, changes its column, writes history and records notification intent in one database transaction. A background dispatcher later handles the intent. A separate job execution entry point does not by itself make each business feature a microservice.

Benefits: fewer network calls between business modules, simpler all-or-nothing writes, fewer deployments to operate and easier end-to-end debugging. Drawbacks: modules generally release together; scaling the API often scales the whole application; careless coupling can make a feature change affect other areas. Enforce clear module boundaries and tests.

Microservices split business capabilities into independently deployable services. For example, an Accounts service, Boards service and Notifications service communicate over network requests/events, with deliberately owned data boundaries. A board save might commit first and publish an event for Notifications to process later. Partial network failure, duplicates and delayed delivery must be handled explicitly.

Benefits: teams can deploy and scale some services independently, and failures can be isolated when boundaries are designed correctly. Drawbacks: more networking, deployments, monitoring and data-consistency work. One shared transaction normally cannot cover separate services/databases, and service failure can still affect other services through dependencies. Multiple folders or cloud products alone do not create microservices.

Our planned backend is a **modular monolith**. It is not implemented yet. This choice favors a small team's ability to build correct shared-work behavior with less operational overhead. A monolith can run many instances behind managed ingress; it does not mean one server or an inability to scale. We can later extract a well-separated capability, such as high-volume notification delivery, if measurements or independent-team ownership justify it. That extraction still requires real interface/data/delivery work.

Flowboard has connected data and simultaneous edits, so PostgreSQL is a strong fit. The previous D1 idea is a simpler integrated Cloudflare alternative, but switching SQLite/D1 to PostgreSQL later is real engine/schema work. Standard PostgreSQL and a separate runtime boundary better fit the updated portability goal.

We start with one application, not many microservices. We will add Redis, separate queues, replicas or shards only when a measured bottleneck or product requirement justifies them. Every added service also adds failure, configuration and debugging work.

Performance means time the user waits for a complete action, not just a framework's advertised speed. Measure browser rendering, network, authentication, query count, database/lock wait and cold starts. A Node server close to PostgreSQL may outperform an edge Worker for a multi-query transaction; the planned compatibility/performance spike will compare both.

## New product rules: project access, trash and spreadsheet import

A project grant is like a key to one office: being invited to Website does not open Operations. Owner has all keys in their workspace; a Project Manager can manage people/cards only inside their granted project. A manager cannot turn themselves into the workspace owner or give someone else manager authority.

Soft delete means move a card into recoverable trash instead of instantly destroying its content. Flowboard saves a server deadline exactly 24 hours later. Restore works before that deadline; cleanup can retry later without changing the deadline. This costs storage/cleanup work but makes recovery possible. Physical deletion immediately would not support that requirement.

An import preview is a rehearsal: show what each spreadsheet row would create before making cards. Stable External ID identifies the same source task across uploads; an HTTP idempotency key identifies the same confirmation request across retries. Both protect against duplicates at different levels. Unknown project people are errors, not automatic invitations. The 98-feature checklist separates written plans from tested Backend, UI and integrated behavior.

## Sources

[React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html), [Vite](https://vite.dev/guide/), [Hono](https://hono.dev/docs), [PostgreSQL](https://www.postgresql.org/about/), [Neon plans](https://neon.com/docs/introduction/plans), [Workers](https://developers.cloudflare.com/workers/), [Hyperdrive](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/), [Kysely](https://kysely.dev/), [pg](https://node-postgres.com/), [Better Auth](https://better-auth.com/docs/introduction), [Node](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs). Hosting caveats and alternatives are expanded in [the stack research](research/stack-comparison.md).
