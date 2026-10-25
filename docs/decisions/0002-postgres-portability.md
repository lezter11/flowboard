# ADR 0002: PostgreSQL and a portable application boundary

Date: 2026-10-26. Status: recommended v0.2 baseline, pending compatibility/performance spike. Supersedes ADR 0001's D1 recommendation; no deployed database migration is needed because no app exists.

## Context

The user prioritizes performance, free-tier initial development, future growth and modular migration from Cloudflare to AWS/Azure. An all-Cloudflare design is no longer the only optimization target. We need to teach why choices differ and retain evidence.

## Choice

Use PostgreSQL schema/transactions with pg/Kysely and Hono application services. Initially host React assets/API on Workers and use Neon via Hyperdrive with query caching disabled. Keep a Node entry point and local PostgreSQL tests from the first slice, and rehearse a container before claiming portability. Better Auth OAuth/session storage is a compatibility-spike candidate, not a verified integration.

## Why and alternatives

PostgreSQL supports interactive transactions and moves among managed PostgreSQL hosts with less dialect/schema change. D1 remains attractive for a small Cloudflare-only app, but uses SQLite/binding-specific mutation patterns and would need an engine migration. Supabase is a good alternative if integrated auth/storage/realtime is preferred; direct client coupling to those services increases later replacement work.

Workers fits the low-cost managed pilot preference. Node near the database might be faster for transaction-heavy requests. Neither has been benchmarked for Flowboard. Hono's documented Node adapter makes this comparison concrete without splitting domain logic into services. React/Vite fits the interactive authenticated board; SSR can be revisited if actual public-page needs emerge.

## Consequences

An additional database provider, pooling/region planning, PostgreSQL migrations and a second runtime harness are required. Free-tier CPU/quota/suspension may fail the performance target; upgrading warm capacity or changing compute is an honest possible outcome. Platform migrations still require IAM, networking, secrets, queues/object transfer and observability work.

Keep 11 old SQLite checks under the D1 prototype, but do not count them as PostgreSQL validation. Root architecture and checklist supersede research alternatives. [Stack comparison and primary sources](../research/stack-comparison.md).

## Gate before implementation commitment

Prove actual pg transaction rollback, Hono Worker/Node behavior, auth/session lifecycle and CPU, cross-tenant checks, bounded board read/move latency and concurrency correctness. Record warm/cold distributions, regions/plans and quota consumption. If results favor Node near PostgreSQL, amend this decision rather than defending the original host choice.
