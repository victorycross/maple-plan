# Maple Plan

Educational Canadian financial-literacy and planning platform.

**Live:** https://maple-plan-david-martins-projects-42ed4350.vercel.app (alias: https://maple.brightpathtechnology.io)

## What it does

A single-page React app that helps Canadians model their financial future. Features household/spouse modeling, 12 Canadian account types (RRSP, TFSA, FHSA, DPSP, DCPP, LIRA/LIF, RRIF, RESP, non-registered, etc.), multi-mortgage tracking with full lender details, life-phase expense modeling (working / retired-with-mortgage / retired-without-mortgage), CPP/OAS/GIS projections with timing optimization, RRSP→RRIF drawdown simulation, 2026 federal+provincial tax brackets for all 13 jurisdictions, estate checklist with document uploads, Monarch transaction-CSV import with auto-categorization and cash-flow analysis, and an AI coach (Claude Sonnet 4.6) that sees your profile and answers personalized questions.

## Stack

Single `index.html` (React 18 + Tailwind + Recharts + Supabase JS via CDN). No build step. Backend is Supabase Postgres + Auth + Storage + one Edge Function. AI coach calls Anthropic's Messages API server-side. Hosted on Vercel from this GitHub repo (auto-deploys on push to `main`).

## Deploying

Push to `main` → Vercel builds and deploys in ~60s. That's it.

## Local development

Open `index.html` directly in any modern browser, or:
```bash
npx serve .
```
The hardcoded Supabase URL in the file means it'll connect to the production database — sign in with a throwaway email if testing destructive changes.

## Full docs

See **[HANDOFF.md](./HANDOFF.md)** for architecture, database schema, edge function details, secrets management, code map, known issues, and roadmap.

## Educational use only

Not regulated financial, investment, tax, legal, or insurance advice. Verify with the CRA, Service Canada, or a licensed professional before acting on anything.
