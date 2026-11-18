<div align="center">

# Policy-Driven PR-to-PO

**Raise purchase requests by chat. Get decisions that follow the procurement policy.**
**Change the policy as data, without touching code.**

![Next.js](https://img.shields.io/badge/Next.js_15-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![Tests](https://img.shields.io/badge/tests-50_passing-2ea44f)

**Live app: [policy-driven-pr-to-po.vercel.app](https://policy-driven-pr-to-po.vercel.app)** · [Decisions and assumptions](DECISIONS.md) · [Approach and AI use](APPROACH.md)

</div>

---

## Contents

- [The problem](#the-problem)
- [What the app does](#what-the-app-does)
- [How a decision is made](#how-a-decision-is-made)
- [Policy as data](#policy-as-data)
- [Screens](#screens)
- [Quick start](#quick-start)
- [Blind-test runbook](#blind-test-runbook)
- [API](#api)
- [Architecture](#architecture)
- [Testing](#testing)
- [Deployment](#deployment)

---

## The problem

Corvo Engineering, a fictional manufacturer with two plants (PUN1 Bhosari and CHK1 Chakan), receives purchase requisitions (PRs) every day. For each one, Procurement has to choose between three paths: buy against a rate contract, order from the preferred supplier, or collect quotes first. Done by hand, this is slow and inconsistent. People also split large needs into small PRs to stay under the quote limits, and every policy change means retraining everyone.

This app automates those decisions under **Procurement Policy v5.0**. It is built so that the next policy version takes effect through an upload and an approval, with no code change.

## What the app does

- 💬 **Chat intake.** A requester types something like *"need 200 nitrile gloves for Chakan by next Friday"*. The assistant matches the item against the item master. It never invents items. It asks for whatever is missing, confirms, and raises the PR. It also tells the requester what the policy will do with it.
- ⚙️ **Decision engine.** It applies the full policy:
  - item matching;
  - clubbing of split PRs into one requirement;
  - valuation;
  - rate contracts, including ceilings and contracts that exist only as signed PDFs;
  - the ordered decision rules;
  - preferred suppliers;
  - PO consolidation.
- 📜 **Versioned policy with effective dates.** Upload an amendment (PDF or text), describe a change in chat, or edit the rules directly. The app shows what will change in plain language and previews the impact on a real batch. Once approved, the new version applies from its effective date.
- 🧑‍💼 **Buyer workspace.** Every requirement shows the decision and the reason for it: the clause, the policy version, and the contract or PO it relied on. Approving creates the PO or RFQ/RFP. An override needs a written reason. Every action is recorded with who did it and when.
- 🏆 **Preferred supplier lists.** They are ranked from purchase history, contracts and ratings, the score breakdown is shown for each supplier, and the lists can be exported as CSV for any date.
- 📄 **Contracts from PDFs.** A buyer can add a contract that exists only as a signed PDF by extracting it from the PDF, or enter it by hand.
- 🔌 **API and CSV.** `POST /api/process-batch` takes a PR batch CSV and returns the decisions in the required export format.

The engine reproduces all **14 worked examples** and all **3 example preferred-supplier lists** from the kit, and no Blocked or Inactive supplier ever receives a PO or a suggestion.

## How a decision is made

```mermaid
flowchart LR
    A[PR lines<br/>chat or CSV] --> B[Intake checks<br/>plant, qty, unit]
    B --> C[Item matching<br/>policy 1]
    C --> D[Clubbing<br/>policy 2]
    D --> E[Valuation<br/>policy 3]
    E --> F[Contracts and ceilings<br/>policy 4]
    F --> G{Rules in order<br/>policy 5}
    G -->|PO| H[Supplier and price<br/>policy 6]
    G -->|Sourcing| I[Suggested suppliers<br/>policy 6.4]
    H --> J[PO consolidation<br/>policy 7]
    J --> K[Buyer workspace<br/>approve or override]
    I --> K
```

Each requirement is decided under the policy version **in force on its requirement date**. If an amendment takes effect partway through a batch, the earlier requirements use the old version and the later ones use the new version.

| Route | When (v5.0) | Outcome |
|---|---|---|
| `NEW_ITEM_SOURCING` | No item master match | Sourcing; the buyer finds suppliers |
| `CAPEX_SOURCING` | Item type is Capex | Sourcing, 5 suggested suppliers, capex approval |
| `CONTRACT_PO` | A contract applies and has ceiling left | PO at the contract rate |
| `EMERGENCY_PO` | Emergency, ≤ ₹5 lakh, bought from an Active supplier in the last 365 days | PO to the 1st preferred supplier |
| `SPOT_PO` | < ₹2 lakh, bought from an Active supplier in the last 365 days | PO to the 1st preferred supplier |
| `RFQ` | < ₹10 lakh | Sourcing, 3 suggested suppliers |
| `RFP` | ≥ ₹10 lakh | Sourcing, 5 suggested suppliers |
| `NOT_PROCESSED` | Invalid line, e.g. quantity 0 or an unknown plant | Returned with the reason |

## Policy as data

A policy version is a single validated JSON document with an effective date. It contains:

- **Parameters:** the plants in scope, clubbing windows, the valuation order and lookbacks, contract ceiling handling, supplier eligibility, preferred-list ranking weights, and the consolidation window.
- **Rules:** an ordered list. The first rule whose condition holds decides the outcome.

```json
{
  "id": "R5.4", "clause": "5.4", "title": "Spot PO",
  "when": { "all": [
    { "fact": "value", "op": "lt", "value": 200000 },
    { "fact": "days_since_last_eligible_purchase", "op": "lte", "value": 365 }
  ]},
  "outcome": { "decision": "PO", "route": "SPOT_PO", "supplier": "preferred_1" }
}
```

Conditions can use about 30 facts that the engine computes for each requirement, including plant, category, item type, value, emergency, contract headroom, days since last purchase, days to need-by and department. A new kind of rule, such as *"at Chakan, safety items always need an RFQ"*, is one more entry in the list. It needs no code.

**From an amendment to a decision:**

```mermaid
flowchart LR
    A[Amendment<br/>PDF, text or chat] --> B[Reader<br/>AI or built-in]
    B --> C[Draft version]
    C --> D[Validation and<br/>plain-language diff]
    D --> E[Impact preview<br/>on a real batch]
    E --> F{Approve?}
    F -->|Yes| G[Active from its<br/>effective date]
    F -->|No| H[Rejected, kept<br/>in history]
```

The approver reviews the differences that the code computes from the two policy documents. The AI's own summary is shown separately. Approved versions are never edited: every change is a new version.

## Screens

| Page | For | Use it to |
|---|---|---|
| **Raise a PR** `/chat` | Requesters | Describe what you need; the assistant handles the rest |
| **Buyer workspace** `/workspace` | Buyers | Review each requirement, then approve, override or return it |
| **PR batches** `/batches` | Buyers | Upload a CSV, re-run it under the current policy, export the decisions |
| **Policy** `/policy` | Procurement | Upload or describe a change, review the diff, approve |
| **Contracts** `/contracts` | Buyers | See the register; add a PDF-only contract |
| **Preferred suppliers** `/suppliers` | Buyers | See the ranked list per item as of any date; export CSV |
| **Audit trail** `/audit` | Everyone | See every action with who and when |
| **Master data** `/data` | Admin | Load the item, supplier, PO history, plant and contract CSVs |

## Quick start

**One command (Docker).** Put your copy of the task kit in `./kit` with its folder layout. The kit is git-ignored and never committed. Then run:

```bash
docker compose up --build
```

Open <http://localhost:3000>. On first start the app sets up the database, loads the master data and contracts (including the PDF-only ones), and seeds policy v5.0.

<details>
<summary><b>Developer setup</b></summary>

Create a `.env` file in the project root (it is git-ignored) pointing at the local Docker database:

```bash
DATABASE_URL=postgresql://corvo:corvo@localhost:5433/corvo
DATABASE_URL_UNPOOLED=postgresql://corvo:corvo@localhost:5433/corvo
```

Then:

```bash
npm install
docker compose up -d db
npx prisma migrate deploy
npm run db:seed -- --kit ./kit    # master data, contracts, policy v5.0
npm run dev                       # http://localhost:3000
npm test                          # 50 tests
npm run batch -- --kit ./kit      # offline run, writes ./tmp/run.csv
```

</details>

<details>
<summary><b>Optional AI</b></summary>

Set one of `GEMINI_API_KEY`, `GROQ_API_KEY` or `OPENAI_API_KEY`. The AI reads amendment documents and free-form chat messages. It never makes a decision. Without a key, the app uses its built-in parsers and stays fully usable.

</details>

## Blind-test runbook

These steps use only features of the app, so no code changes are needed.

1. **Run 1.** On **PR batches**, upload the new batch and keep the default policy option. Download the CSV and save it as `submission/chandan__run1.csv`.
2. **Amendment.** On **Policy**, upload the amendment and choose **Read and create draft**. Check the version, the effective date and the list of changes, then select **Preview impact**. Switch your role to *Procurement Head* and **Approve**.
3. **Run 2.** On **PR batches**, choose **Re-run with current policy** on the same batch. Download the CSV and save it as `submission/chandan__run2.csv`.
4. **Preferred lists.** On **Preferred suppliers**, set the given date and choose **Export**. Save the file as `submission/chandan__preferred.csv`.
5. Commit only the `submission/` folder and push it before 12:00.

To repeat Run 1 after the amendment is approved, use the **Force v5.0** option.

## API

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/process-batch` | Takes a PR batch CSV and returns the decisions. Add `?format=csv` to get the CSV. |
| `GET` | `/api/runs/{id}/export` | Decisions CSV for a run |
| `GET` | `/api/preferred?date=YYYY-MM-DD&format=csv` | Preferred supplier lists as of a date |
| `GET` `POST` | `/api/policy`, `/api/policy/{id}` | List versions, create drafts, approve or reject, `?impact=1` |
| `GET` | `/api/policy/facts` | The facts and operators a rule can use |
| `POST` | `/api/runs/{id}/actions` | Approve, override or return a requirement |
| `POST` | `/api/contracts/extract`, `/api/contracts` | Read a contract PDF; save a contract |
| `POST` | `/api/chat` | Chat intake |

```bash
curl -X POST --data-binary @batch.csv -H "Content-Type: text/csv" \
  "http://localhost:3000/api/process-batch?format=csv" -o decisions.csv
```

**Output columns** (one row per PR line): `pr_no, pr_line, resolved_item_code, group_id, po_id, decision, route, supplier_id, unit_price, group_value_inr, suggested_supplier_ids, policy_version, reason`

## Architecture

```
src/
├── engine/            Decision logic: pure TypeScript, no database, no AI
│   ├── policy/        Schema, v5.0 as data, facts, conditions, diff, validation
│   ├── engine.ts      Intake → clubbing → valuation → contracts → rules → suppliers → POs
│   ├── matching.ts    Item matching (short forms, sizes, unknown items)
│   ├── preferred.ts   Preferred supplier ranking and suggestions
│   └── contract-text.ts  Contract PDF extraction
├── server/            Database, runs, buyer actions, policy approval, chat, AI client
└── app/               Next.js pages and API routes
prisma/                Data model and migrations
scripts/               Seed, offline batch run, reset
tests/                 Vitest suites
```

- The **engine is separate from the UI and the database**, so it can be tested on its own, and the CLI, the API and the UI give identical results.
- **Runs are reproducible:** the same PR lines, master data and policy versions always give the same output.
- **Every action is audited:** PRs, runs, approvals, overrides, policy changes, contracts and data loads.

## Testing

```bash
npm test
```

The 50 tests cover:

- clubbing windows;
- contract selection and ceilings;
- blocked and inactive suppliers;
- Capex, emergency and consolidation rules;
- intake rejections;
- switching versions by effective date;
- a plant-specific rule added as data;
- item matching;
- policy diff and validation;
- contract PDF extraction;
- all 14 worked examples and 3 preferred lists. These run only when `./kit` is present.

## Deployment

The app is hosted on **Vercel** with a **Neon** Postgres database on the free tier, which does not expire.

1. Import the repo into Vercel, then go to **Storage → Neon** and connect a database. This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
2. Optionally, add `GEMINI_API_KEY`.
3. The build runs `npm run vercel-build`, which applies the database migrations.
4. Load the master data once:

   ```bash
   DATABASE_URL=<neon url> DATABASE_URL_UNPOOLED=<neon url> npm run db:seed -- --kit ./kit
   ```

   You can also upload the CSVs on `/data` instead.

---

<div align="center">

Built for the Cantill.ai Full-stack Intern task · All company, supplier and item data is fictional

</div>
