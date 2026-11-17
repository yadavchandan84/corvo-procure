# DECISIONS

Where the brief, the policy (v5.0) or the data is silent or ambiguous, this is what I noticed, what I decided and why. Most of these decisions are **policy parameters**, so Procurement can change them as data without a code change. Each entry names the parameter where there is one.

The engine reproduces all 14 worked decisions and all 3 example preferred-supplier lists. `tests/worked-examples.test.ts` checks this whenever the kit is present locally.

---

## 1. Policy versions and effective dates

**1.1 Which version applies.** *Noticed:* the brief says a new version is activated "from its effective date", but not which date of a PR is compared with it. *Decided:* each **requirement** is decided under the approved version in force on its **requirement date**, the creation date of its first line (policy 2.3). If several versions are in force, the one with the latest effective date wins; for equal dates, the one approved later wins. *Why:* the policy already uses the requirement date as the reference date for contracts and history (2.3), so one date governs everything about a requirement. A batch that spans an effective date is therefore split correctly: earlier requirements show `policy_version` 5.0 and later ones show the new version.

**1.2 One version per requirement.** Clubbing windows, valuation, rules and consolidation for a requirement all come from that requirement's version. A line created after an amendment can still join a requirement started before it, under the older version's windows. A PO only consolidates requirements decided under the **same** version, so one PO never mixes two rule sets.

**1.3 Forcing a version.** A batch can be re-run with one version forced for every line (option on the PR batches page, or `?policyVersionId=` on the API). This lets anyone reproduce "Run 1 under v5.0" after a newer version has been approved.

**1.4 Before the first version.** A requirement dated before the earliest version's effective date (1 April 2026) uses the earliest version, and the line carries a warning.

**1.5 What approval means.** An amendment is read into a **draft**. The approver sees a difference list that the code computes from the data. It is never the AI's own summary. The approver also sees any parts the reader could not represent, validation errors, and an impact preview: the latest batch re-run with and without the draft, listing every line that changes. Only an approved version is used. Approved versions are never edited; a change is always a new version, so history is kept.

## 2. Lines not processed (`route = NOT_PROCESSED`)

A line is not processed, and is returned to the requester with the reason, when:

| Case | Example in the sample | Parameter |
|---|---|---|
| Quantity zero or negative | PR-26-00172 (qty 0) | `intake.rejectNonPositiveQuantity` |
| Plant outside the policy scope or not in the plant master | PR-26-00173 (PUN2) | `scope.plants`, `intake.rejectPlantsOutsideScope` |
| Unit differs from the item master unit (after aliases like PCS = NOS, LTRS = LTR) | none | `intake.rejectUomMismatch` |
| Description matches several items equally well | none | `intake.rejectAmbiguousItems` |
| Missing or invalid need-by date, creation time or quantity | none | `intake.rejectMissingNeedBy` |
| Same `pr_no`/`pr_line` twice in one batch (only the first is processed) | none | always |

*Why:* PUN2 could be a typo for PUN1, but guessing a plant sends goods to the wrong place, and the policy explicitly applies only to PUN1 and CHK1. A unit mismatch makes the value meaningless: 2 BRL priced per LTR would pick the wrong route. These lines are excluded from clubbing. For them, `decision` is left blank: the brief defines only `PO` and `SOURCING_REQUEST`, and specifies only the route `NOT_PROCESSED`. `resolved_item_code` is still filled where the item matched, so the buyer sees what was asked for.

## 3. Item matching (policy 1)

- **A valid item code is used as given (1.1)**, even if the description says otherwise. If the description clearly points to a different item, the line gets a warning for the buyer.
- **Free text is matched deterministically**, never by the AI. Matching normalises short forms (brg, hyd, pneu, "welding rod" = electrode), units (`24"` = 24 inch, `3 mm` = 3mm), hyphens and plurals, then scores items by IDF-weighted token overlap. If a size or model number in the request conflicts with the item's ("M12x50" against "M10x40", "6206" against "6308"), that item is heavily penalised, so a different variant is never matched.
- **Noise is ignored:** "- urgent", "as per sample", "(repeat)" and "for maintenance" carry no item meaning. All 39 free-text lines in the sample match the item master, except the two genuinely new items (water purifier, ultrasonic thickness gauge).
- **"As per sample"** (PR-26-00036, 00075, 00119) is matched to the catalogue item. The description matches exactly, and a sample usually shows the buyer what to send rather than asking for a different specification.
- **Batch threshold:** a match is accepted at a score of 0.7 or more, with at least a 0.05 lead over the second candidate (`itemMatching.minScore`, `minMargin`). Below 0.7 the line is a new item. Within the margin it is ambiguous (section 2). The chat is stricter: it asks unless the score is 0.85 or more with a 0.1 lead.
- **A requester can mark an item as new explicitly** with item code `NEW`. The chat does this after the requester confirms that none of the candidates is right, so the batch matcher never overrides the requester's answer.

## 4. Clubbing (policy 2)

- "Within 14 calendar days" compares calendar **dates** (time of day ignored), inclusive. "Within 7 days either side" compares need-by dates, inclusive.
- The urgency **field** decides an emergency. Words in the description do not: "- urgent" appears on PR-26-00018, 00023 and 00139 and on PR-26-00167 line 2, all with urgency Normal. Treating free text as an emergency would let anyone bypass quotes by typing "urgent". Requesters choose urgency explicitly in the chat.
- If any clubbed line is an Emergency, the whole requirement is (2.3).
- New items are never clubbed (1.2). Lines of one multi-line PR with different plants or items are separate requirements.
- Duplicates in spirit are clubbed, not dropped. The "(repeat)" line PR-26-00141 is treated as a genuine need. With PR-26-00082, 00140, 00142 and 00143 (all hydraulic pump seal kits for PUN1) it forms one requirement of 20 sets worth ₹3,83,046, which goes to RFQ. Each line alone would have been a spot PO under ₹2 lakh. This is the anti-splitting intent of 2.1.
- PR-26-00174/00175 look like a split (two servo drives, 4 minutes apart). They are clubbed into one requirement (₹1,31,676, still a spot PO). PR-26-00147 and 00149 are **not** added: their need-by dates are 8 and 36 days from the first line's, outside the 7-day window.

## 5. Valuation (policy 3)

- **3.1(b) uses the most recent PO from any supplier**, including suppliers now Blocked or Inactive. *Why:* valuation estimates what the requirement costs. The policy says "Active" where it means it (4.1, 5.3, 5.4, 6.1) and not here. This affects six values in the sample (e.g. ITM-1017 and ITM-1020, last bought from S011, now Blocked) and no routes. Switching to "Active suppliers only" is one field: `valuation.lastPoSuppliers = "eligible"`.
- **The requirement value and the PO price can differ.** `group_value_inr` follows 3.1. The `unit_price` of a spot or emergency PO is the 1st preferred supplier's reference price (6.3). Worked example 6 confirms this: value ₹1,56,170 = 7370 × ₹21.19 (S028's last PO), but the PO goes to S027 at ₹21.59 (S027's reference price).
- A new item without an estimated price still goes to NEW_ITEM_SOURCING, with an empty value and a warning.
- Lookback windows are inclusive: a PO dated exactly N days before the requirement date counts.

## 6. Contracts (policy 4)

- **Ceiling check:** consumed + this requirement ≤ ceiling. Equal is allowed ("must not exceed").
- **Consumption order:** requirements are processed in requirement-date order (creation time, then PR number). Only requirements that actually end in a CONTRACT_PO consume ceiling, so a Capex rule or a new earlier rule never uses up a contract.
- **PDF-only contracts** (RC-2026-031, RC-2026-033) are extracted from the signed PDF, start with consumed value 0 (4.2), and apply from their start date (4.4). Every register contract was also reconciled against its PDF (supplier, dates, ceiling, every rate), and no differences were found. The contract upload screen shows differences if a PDF disagrees with the register.
- **Contracts with a Blocked supplier are not applicable** (4.1), e.g. RC-2026-005 with S004 for aluminium plate. Expired contracts (RC-2025-020) are not applicable, but still count for the preferred list (6.1b).
- **Batch runs are reproducible.** A batch run starts from the register's consumed values plus the consumption within that run. POs approved in the app do not reduce ceilings for later batch runs, so Run 1 and Run 2 can be repeated and compared. The live chat queue is real-time and does count contract POs already approved from it.
- RC-2025-014 (Weldtech) ends on 30 Nov 2026. Requirements dated in November use it; December ones would not.

## 7. Decision rules (policy 5)

- Rules are data: an ordered list of conditions and outcomes. The first enabled rule whose condition holds decides, exactly as in 5.
- 1.2 (new item) is encoded as the first rule, before 5.1.
- **A PO rule must be able to name an eligible supplier.** If a rule's conditions hold but there is no usable contract or Active preferred supplier, that rule does not fit, and evaluation continues with the next rule (5.7: Blocked or Inactive suppliers never receive a PO). This never happens under v5.0, because "bought from an Active supplier in 365 days" implies one is on the 548-day list. It protects future amendments that change one window and not the other.
- "Bought from an Active supplier" uses the supplier's **current** status in the supplier master.
- **Suggested suppliers when too few exist:** 6.4 asks for 3 or 5, but some categories have fewer Active suppliers. Then I suggest all that exist, and the reason says so. Worked example 11 does the same (4 suppliers for an RFP).

## 8. Preferred supplier ranking (policy 6.2)

**Who is listed (6.1):** Active suppliers with a PO for the item in the 548 days up to the date, or with a contract for the item that started on or before the date, even if it has since expired.

**Score** (each part from 0 to 1, weights stored in the policy):

| Part | Weight | Definition |
|---|---|---|
| Frequency | 0.30 | POs in the window ÷ the highest count among listed suppliers |
| Recency | 0.25 | 1 if the last PO is within 90 days, 0.5 if within 365, otherwise 0 (the bands in the worked examples) |
| Contract | 0.20 | 1 if the supplier has held a contract for the item |
| On-time | 0.125 | on-time % ÷ 100 |
| Quality | 0.125 | quality rating ÷ 5 |

Ties go to the lower supplier id. The reference price follows 6.3: the supplier's latest PO in the window, otherwise its latest contract rate.

**Why these weights.** 6.2 asks for "the best choice for a direct PO". Proven buying history (frequency and recency, 55%) says most about whether a supplier actually delivers this item to Corvo. A contract (20%) shows Corvo vetted the supplier for the item. Ratings (25%) break ties between similar histories, but they cannot lift a supplier Corvo rarely uses above its regular one. The weights reproduce all three example lists. They also give the 1st preferred supplier implied by every PO in the worked examples (S024 for hydraulic oil, S027 for VCI bags, S023 for hoses, S014 for oil seals) and the suggestion orders in examples 3 and 9 to 12. The closest case is hydraulic oil: S024 scores 0.664 and S023 scores 0.615. S023 has more POs, but its last one is 260 days old, while S024's is 14 days old.

**Explainability.** The workspace shows every listed supplier with its PO count, last PO, recency band, contract flag, ratings, score and reference price source. The score breakdown appears on hover. The preferred-supplier page explains the formula in words.

**Top-up for sourcing (6.4):** after the preferred list, other Active suppliers listing the item's category, ordered by 0.5 × on-time + 0.5 × quality (`suggestions.topUpWeights`). This reproduces the suggestions in examples 10, 11 and 12. Capex items get the preferred list first and the category second.

## 9. PO consolidation (policy 7)

- "Within 24 hours" is measured in minutes between the first-line creation times, inclusive, from the **first** requirement on the PO (not chained).
- Consolidation requires the same supplier, plant and route (`consolidation.sameFields`), and the same policy version (1.2).
- **PO numbers are ours**, sequential in order of each PO's first requirement (`PO-0001`, ...). Our numbers are one higher than in the worked examples (e.g. PO-0012 for example 1 instead of PO-0011). The earliest PO in the batch is the servo drive requirement PR-26-00174/175, created at 08:10 on 2 Nov. The examples appear to have been numbered without it. The grouping of requirements into POs is the same.
- **Approving a consolidated PO issues the whole PO.** All pending requirements on it go onto one document. An overridden requirement leaves the shared PO and gets its own document.

## 10. Chat intake

- The assistant never invents items. It matches against the item master and shows the item code and unit. If the match is unclear it shows up to 3 candidates plus "none of these". If nothing matches, it asks whether the item is genuinely new before raising it, and then asks for an estimated price.
- It asks for anything missing, in this order: item, quantity, plant, need-by date, urgency, and the estimate for new items. Then it shows a summary to confirm.
- "Urgent" or "ASAP" in a message does not set Emergency. The assistant asks whether it is an emergency and explains what that means (section 4).
- "Pune" means PUN1 (Bhosari); Chakan means CHK1. Need-by dates in the past are rejected. "Next Friday" is the Friday of next week, and the confirmation shows the resolved date so the requester can correct it.
- If the requester gives a different unit from the item master's, the quantity is recorded in the item master unit and the confirmation says so.
- After creating the PR, the assistant tells the requester what the policy will do with it (route, supplier or suggestions, value, clause) and whether it was clubbed with other open PRs.
- Chat PRs (`PR-CH-xxxxx`) form a live queue that is re-decided on every new PR, so clubbing works across requesters. Lines that have been approved into a PO or sourcing request leave the queue and stop clubbing.

## 11. Buyer workspace and record keeping (8.1)

- **Approve** creates the document: a PO (`PO-26-xxxxx`), an RFQ or RFP, a Capex sourcing request, or a new-item sourcing request.
- **Override** needs a written reason of at least a few words. It stores the original decision next to the override, and the original stays visible. An override can never give a PO to, or suggest, a Blocked or Inactive supplier (5.7).
- **Return to requester** needs a reason.
- Every action (PR raised, batch run, approval, override, policy draft, approval or rejection, contract added, data import) is written to the audit trail with who and when.
- **No login:** the reviewers need instant access, so the app has no authentication. The user picks a name and role in the sidebar, and every action records it. Roles only guide the UI; a real deployment would put SSO in front.

## 12. Timeline

The email lists the build deadline as "Wed 19 Nov", but 19 Nov 2026 is a Thursday, and the brief says Thu 19 Nov 10:00 IST. I treated **Thu 19 Nov 10:00 IST** as the code freeze. The blind test then uses only the app's own features (batch upload, policy upload and approval, exports), with no code changes.
