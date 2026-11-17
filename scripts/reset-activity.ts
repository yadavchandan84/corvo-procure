/**
 * Remove all activity (batches, runs, buyer actions, documents, chats, audit, policy versions other
 * than the v5.0 seed) while keeping master data and contracts. Use before a clean demo.
 *   npx tsx scripts/reset-activity.ts --yes
 */
import { prisma } from '../src/server/db';
import { ensureSeedPolicy } from '../src/server/repo';

async function main() {
  if (!process.argv.includes('--yes')) {
    console.log('This deletes all batches, runs, chats, audit entries and non-seed policy versions. Re-run with --yes.');
    return;
  }
  await prisma.$transaction([
    prisma.document.deleteMany(),
    prisma.buyerAction.deleteMany(),
    prisma.decisionRun.deleteMany(),
    prisma.prLine.deleteMany(),
    prisma.prBatch.deleteMany(),
    prisma.chatMessage.deleteMany(),
    prisma.chatSession.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.counter.deleteMany(),
    prisma.policyVersion.deleteMany({ where: { sourceType: { not: 'SEED' } } }),
  ]);
  await ensureSeedPolicy();
  console.log('Activity cleared; master data and contracts kept.');
}

main().finally(() => prisma.$disconnect());
