/**
 * Offline CLI: run the decision engine on a PR batch CSV against the kit's master data.
 *   npm run batch -- --kit ./kit --batch ./kit/pr_batches/sample_pr_batch.csv --out ./tmp/run.csv [--policy ./policy.json]
 * The hosted app is the system of record; this CLI exists for tests and quick checks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadKit } from '../src/server/kit-loader';
import { runEngine } from '../src/engine/engine';
import { decisionsToCsv, parsePrBatch } from '../src/engine/csv';
import { POLICY_V5, POLICY_V5_EFFECTIVE_FROM, POLICY_V5_VERSION } from '../src/engine/policy/default-v5';
import type { PolicyVersionRecord } from '../src/engine/types';
import { parsePolicyDefinition } from '../src/engine/policy/schema';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const kit = arg('kit', './kit')!;
  const batch = arg('batch', path.join(kit, 'pr_batches', 'sample_pr_batch.csv'))!;
  const out = arg('out', './tmp/run.csv')!;
  const { data, notes } = await loadKit(kit);
  notes.forEach((n) => console.log('[kit]', n));
  const versions: PolicyVersionRecord[] = [
    { id: 'v5', version: POLICY_V5_VERSION, effectiveFrom: POLICY_V5_EFFECTIVE_FROM, approvedAt: '2026-03-15', definition: parsePolicyDefinition(POLICY_V5) },
  ];
  const extra = arg('policy');
  if (extra) {
    const j = JSON.parse(fs.readFileSync(extra, 'utf8'));
    versions.push({ id: 'extra', version: j.version, effectiveFrom: j.effectiveFrom, approvedAt: '2099-01-01', definition: parsePolicyDefinition(j.definition) });
  }
  const { lines, errors } = parsePrBatch(fs.readFileSync(batch, 'utf8'));
  if (errors.length) console.warn(errors);
  const t0 = Date.now();
  const res = runEngine(data, lines, versions);
  console.log(`engine: ${lines.length} lines in ${Date.now() - t0} ms`, res.summary);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, decisionsToCsv(res.rows));
  fs.writeFileSync(out.replace(/\.csv$/, '.json'), JSON.stringify(res, null, 1));
  console.log('wrote', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
