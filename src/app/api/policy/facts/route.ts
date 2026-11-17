import { NextResponse } from 'next/server';
import { FACTS } from '@/engine/policy/facts';
import { OPERATORS, KNOWN_ROUTES } from '@/engine/policy/schema';

export const runtime = 'nodejs';

/** The vocabulary a policy rule can use: facts, operators and routes. */
export async function GET() {
  return NextResponse.json({ facts: FACTS, operators: OPERATORS, routes: KNOWN_ROUTES });
}
