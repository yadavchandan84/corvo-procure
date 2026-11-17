/**
 * Load master data, the contract register and PDF-only contracts from a local copy of the task kit
 * into the database, and seed policy v5.0.
 *   npm run db:seed -- --kit ./kit            (replace master data)
 *   npm run db:seed -- --kit ./kit --if-empty (only when the database has no items; used by Docker)
 * Against the hosted database: set DATABASE_URL to the hosted connection string and run the same.
 */
import fs from 'node:fs';
import { loadKit } from '../src/server/kit-loader';
import { ensureSeedPolicy, masterDataCounts, replaceMasterData } from '../src/server/repo';
import { prisma } from '../src/server/db';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const kit = arg('kit') ?? process.env.KIT_DIR ?? './kit';
  const ifEmpty = process.argv.includes('--if-empty');
  await ensureSeedPolicy();
  const counts = await masterDataCounts();
  if (ifEmpty && counts.items > 0) {
    console.log('Master data already loaded:', counts);
    return;
  }
  if (!fs.existsSync(`${kit}/master_data/item_master.csv`)) {
    console.log(`No kit found at ${kit}. Load master data from the app's Data page instead.`);
    return;
  }
  const { data, notes } = await loadKit(kit);
  notes.forEach((n) => console.log('[kit]', n));
  await replaceMasterData(data, 'seed script');
  console.log('Loaded:', await masterDataCounts());
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
