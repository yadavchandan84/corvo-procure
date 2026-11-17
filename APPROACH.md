# APPROACH

## How I worked

1. **Read the kit first, code second.** I read the brief, the policy and the worked examples, then profiled the data: 186 PR lines, 39 of them free text; urgency values; plants; units; zero quantities; PO history dates; register against PDF contracts. Section 2 of DECISIONS.md lists the traps this found (PUN2, quantity 0, "- urgent" text, PDF-only contracts, blocked-supplier contracts and history, nearly exhausted ceilings).
2. **Engine before UI.** The decision engine (`src/engine`) is plain TypeScript with no database, framework or AI, so it can be tested on its own. I built it against the 14 worked examples and 3 preferred lists until all of them matched. Then I added the database, the API and the screens around it.
3. **Policy as data from the start.** No limit, window, rule order or outcome is written into the engine. v5.0 is one JSON document (`src/engine/policy/default-v5.ts`) validated by a schema (`schema.ts`). Rules are an ordered list of conditions over a fixed set of **facts** the engine computes for each requirement (`facts.ts`: plant, category, item type, value, emergency, contract usable and headroom, days since last eligible purchase, days to need-by, department, top supplier ratings...). A new kind of rule, such as one that applies only at CHK1, is a new list entry. It needs no code.
4. **AI only where it reads text.** The AI turns amendment documents, chat descriptions of policy changes and requester messages into structured data. It never decides a route. What the AI proposes is validated against the schema, and the approver sees a difference list computed by code. Item codes always come from the deterministic matcher. If no AI key is set, or the AI fails, built-in parsers take over, so the app is fully usable without AI.

## Architecture

```
src/engine/        pure decision logic (no I/O)
  policy/          schema (zod), v5.0 as data, facts, conditions, diff, validation
  matching.ts      item matching (1.1)
  engine.ts        intake checks -> clubbing (2) -> valuation (3) -> contracts (4) -> rules (5) -> suppliers (6) -> consolidation (7)
  preferred.ts     preferred supplier list, ranking and 6.4 suggestions
  contract-text.ts signed-contract PDF extraction and reconciliation
src/server/        database (Prisma), runs and buyer actions, policy drafts and approval, chat, AI client, PDF text
src/app/api/       REST API (POST /api/process-batch, runs, export, policy, contracts, preferred, chat, audit)
src/app/           Next.js screens: chat, buyer workspace, batches, policy, contracts, preferred suppliers, audit, data
tests/             vitest: engine, matching, policy diff/validation, PDF extraction, worked examples (with local kit)
```

- **Stack:** Next.js 15 (React 19, App Router) for the UI and API, PostgreSQL through Prisma, Tailwind. TypeScript end to end.
- **Hosting:** Vercel for the app and Neon for Postgres. Locally: `docker compose up`.
- **Data model:** master data tables (items, suppliers, PO history, plants, contracts with lines), `PolicyVersion` (definition JSON, effective date, status, computed change list, source document, AI notes, who created and approved), `PrBatch` and `PrLine`, `DecisionRun` (the full engine result including per-requirement traces), `BuyerAction` (approve, override, return), `Document` (issued POs and RFQs), `ChatSession` and `ChatMessage`, `AuditLog`.
- **Reproducibility:** a run is a pure function of (PR lines, master data, approved policy versions). It does not depend on wall-clock time or on the AI. The CLI (`npm run batch`), the API and the UI all give identical output, which I checked by diffing their CSVs.

## AI tools used

- **For coding:** Kiro (an AI coding assistant, Claude model) for design discussion, writing most of the code, tests and docs under my direction. I then reviewed and ran it. I checked every engine behaviour against the worked examples and the policy text, and I can explain and change any part.
- **Inside the app (optional):** any OpenAI-compatible model, configured with `GEMINI_API_KEY` (Google Gemini 2.5 Flash by default), `GROQ_API_KEY` or `OPENAI_API_KEY`. It is used for two things:
  1. reading a policy amendment (uploaded PDF or text, or a change described in chat) into a draft policy version, which is validated and diffed before a human approves it;
  2. extracting request details from free-form chat messages, merged with the deterministic parser.

  Without a key, the app uses its deterministic chat parser and a rule-based amendment reader. That reader handles limits, windows, lookbacks, plant-only limits and effective dates, and lists anything it did not understand. The policy editor in the app covers everything else. No decision ever calls an AI.

## Testing

`npm test` runs 50 tests:

- clubbing windows, plants and new items;
- contract selection, ceilings and consumption order;
- blocked and inactive suppliers;
- Capex, emergency and consolidation rules;
- intake rejections;
- effective-date switching between versions, and a new plant-specific rule added as data;
- item matching on short forms, size conflicts and unknown items;
- policy diff and validation;
- contract PDF extraction;
- the 14 worked examples and 3 preferred lists, plus a check that no Blocked or Inactive supplier appears anywhere (when `./kit` is present).

The kit is git-ignored, so these last tests skip on a clean clone.
