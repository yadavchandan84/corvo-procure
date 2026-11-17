# Corvo Procure: policy-driven PR to PO

Employees raise purchase requests by **chatting**. The system decides each one by following Corvo Engineering's **procurement policy**: a contract PO, an emergency or spot PO to the preferred supplier, or a sourcing request (RFQ, RFP, Capex, new item). The policy is stored as **versioned data with an effective date**. When Procurement uploads an amendment, describes a change in chat, or edits a rule, the app shows what will change in plain language. On approval it decides differently from the effective date, with no code change.

**Hosted app:** https://corvo-procure.vercel.app (see [Deployment](#deployment))
**Docs:** [DECISIONS.md](DECISIONS.md) (judgement calls and the supplier ranking) · [APPROACH.md](APPROACH.md) (how it was built, AI use)

---

## What it does

| Screen | For | What you do there |
|---|---|---|
| **Raise a PR** (`/chat`) | Requesters | Type "need 200 nitrile gloves for Chakan by next Friday". The assistant matches the item master (never invents items), asks for what is missing (quantity, plant, need-by date, urgency, an estimate for new items), confirms, raises the PR and says what the policy will do with it. |
| **Buyer workspace** (`/workspace`) | Buyers | Requirements with their clubbed PR lines, decision, value, supplier and price or suggested suppliers, and why: clause, policy version, contract or PO relied on, every contract checked, the preferred list with scores, and each rule checked in order. One obvious next action: **Approve** creates the PO, RFQ or RFP. **Override** needs a reason and keeps the original. **Return to requester**. |
| **PR batches** (`/batches`) | Buyers | Upload a PR batch CSV, re-run it under the current policy (or force a version), and export the decisions CSV. |
| **Policy** (`/policy`) | Procurement | Upload a policy or amendment (PDF or text), describe a change, or edit the rules. Review the computed differences, the parts the reader could not represent, and an impact preview on the latest batch. Then approve or reject. Every version is listed with its effective date and status. |
| **Contracts** (`/contracts`) | Buyers | The register, plus **add a PDF-only contract** by extracting it from the signed PDF (checked against the register) or entering it by hand. |
| **Preferred suppliers** (`/suppliers`) | Buyers | Ranked list for every item as of any date, with the reason for each rank. **Export CSV** (`item_code, rank, supplier_id, reference_price`, top 3). |
| **Audit trail** (`/audit`) | Everyone | Every action with who and when. |
| **Master data** (`/data`) | Admin | Upload the item, supplier, PO history, plant and contract CSVs. |

The engine implements policy v5.0 in full: item matching (1), clubbing against splitting (2), valuation (3), contracts with ceilings and PDF-only contracts (4), the ordered decision rules with the blocked-supplier ban (5), preferred supplier lists and suggestions (6), PO consolidation (7) and record keeping (8). It reproduces all 14 worked examples and the 3 example preferred lists.

## Run it locally (one command)

Requirements: Docker. Put your copy of the task kit in `./kit`, keeping its folder layout (`kit/master_data`, `kit/contracts`, `kit/pr_batches`). The kit is git-ignored and never committed.

```bash
docker compose up --build
```

Open http://localhost:3000. On first start the app migrates the database, loads master data and contracts (including PDF-only contracts) from `./kit`, and seeds policy v5.0. Without a kit, upload the CSVs on the **Master data** page.

Optional AI (chat understanding and amendment reading): `GEMINI_API_KEY=... docker compose up --build` (or set `GROQ_API_KEY` or `OPENAI_API_KEY`). Without a key the app uses its built-in parsers. Decisions never use AI.

### Developer setup

```bash
npm install
cp .env.example .env              # points at the compose database on localhost:5433
docker compose up -d db
npx prisma migrate deploy
npm run db:seed -- --kit ./kit    # master data, contracts (+ PDFs), policy v5.0
npm run dev                       # http://localhost:3000
npm test                          # 50 tests (worked-example tests need ./kit)
npm run batch -- --kit ./kit      # offline CLI: decisions CSV to ./tmp/run.csv
```

## API

| Method | Path | |
|---|---|---|
| `POST` | `/api/process-batch` | Body: the PR batch CSV (raw `text/csv`, multipart field `file`, or JSON `{"csv": "..."}`). Returns the decisions (`?format=csv` for the CSV). Optional `?policyVersionId=` forces a version. The batch and run are saved for the workspace. |
| `GET` | `/api/runs/{id}/export` | Decisions CSV of a run (format below) |
| `GET` | `/api/preferred?date=YYYY-MM-DD&format=csv` | Preferred supplier lists as of a date |
| `GET/POST` | `/api/policy`, `/api/policy/{id}` | Versions; create a draft (document, chat or editor); approve or reject; `?impact=1` preview |
| `GET` | `/api/policy/facts` | The facts, operators and routes a rule may use |
| `POST` | `/api/runs/{id}/actions` | `{"groupId","action":"APPROVE"|"OVERRIDE"|"RETURN","comment","override"}` |
| `POST` | `/api/contracts/extract`, `/api/contracts` | Extract a contract PDF; save a contract |
| `POST` | `/api/chat` | `{"sessionId","message"}` |

```bash
curl -X POST --data-binary @batch.csv -H "Content-Type: text/csv" "https://<host>/api/process-batch?format=csv" -o decisions.csv
```

**Decisions CSV**, one row per PR line: `pr_no, pr_line, resolved_item_code, group_id, po_id, decision, route, supplier_id, unit_price, group_value_inr, suggested_supplier_ids, policy_version, reason`. Lines not processed have route `NOT_PROCESSED` and the reason.

## Blind-test runbook (no code changes)

1. **Run 1:** on **PR batches**, upload the new batch with the default option. No amendment is approved yet, so it runs under v5.0. Click **CSV** and save it as `submission/chandan__run1.csv`.
2. **Amendment:** on **Policy → Upload a policy or amendment**, upload the amendment and click **Read and create draft**. Check the version, the effective date and the "What will change" list. Click **Preview impact**. If the reader missed something, fix it with **Edit draft**. Switch the sidebar role to *Procurement Head* and click **Approve**.
3. **Run 2:** on **PR batches**, click **Re-run with current policy** on the same batch. Each requirement uses the version in force on its date. Download the CSV as `submission/chandan__run2.csv`.
4. **Preferred lists:** on **Preferred suppliers**, set the given date and click **Export**. Save it as `submission/chandan__preferred.csv`.
5. Commit only the `submission/` folder and push before 12:00.

To reproduce Run 1 after the amendment is approved, use the **Force v5.0** option when uploading or re-running.

## Policy as data

A policy version is one JSON document (see `src/engine/policy/default-v5.ts` for v5.0) with:

- **parameters:** plant scope, intake checks, clubbing windows, valuation order and lookback, contract ceiling rules, supplier eligibility, preferred-list lookback and ranking weights, suggestion top-up, consolidation window and fields;
- **rules:** an ordered list; the first rule whose condition holds decides.

```json
{ "id": "R5.4", "clause": "5.4", "title": "Spot PO",
  "when": { "all": [ { "fact": "value", "op": "lt", "value": 200000 },
                     { "fact": "days_since_last_eligible_purchase", "op": "lte", "value": 365 } ] },
  "outcome": { "decision": "PO", "route": "SPOT_PO", "supplier": "preferred_1" } }
```

Conditions can use about 30 computed facts: plant, category, item type, value, emergency, contract usable and headroom, days since last purchase, days to need-by, department, the top supplier's ratings and more. So "safety items at Chakan above ₹50,000 need an RFQ" is a new rule placed before 5.4. It needs no code change.

## Project layout

```
src/engine/   decision engine (pure TypeScript, unit-tested)      src/server/  DB, runs, policy drafts, chat, AI, PDF
src/app/      Next.js pages and API routes                        prisma/      schema and migrations
scripts/      seed, CLI batch run, reset                          tests/       vitest
```

## Deployment

Vercel (Next.js) with Neon Postgres (free tier, does not expire):

1. In Vercel, import the GitHub repo, then **Storage → Create → Neon** and connect it to the project. This sets `DATABASE_URL`. Also set `DIRECT_URL` to the non-pooled Neon URL (`DATABASE_URL_UNPOOLED`).
2. Optionally set `GEMINI_API_KEY`.
3. The build command `npm run vercel-build` runs `prisma migrate deploy`.
4. Load master data once, from a machine with the kit: `DATABASE_URL=<neon url> DATABASE_URL_UNPOOLED=<neon url> npm run db:seed -- --kit ./kit`. Or upload the CSVs on `/data` and add the PDF-only contracts on `/contracts`.
