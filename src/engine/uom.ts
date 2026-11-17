/** Unit-of-measure aliases, so "PCS" and "NOS" or "LTRS" and "LTR" are treated as the same unit. */
const ALIASES: Record<string, string[]> = {
  NOS: ['NO', 'NOS', 'NOS.', 'NUMBER', 'NUMBERS', 'PCS', 'PC', 'PIECE', 'PIECES', 'EA', 'EACH', 'UNIT', 'UNITS', 'NUM'],
  PAIR: ['PAIR', 'PAIRS', 'PR', 'PRS'],
  LTR: ['LTR', 'LTRS', 'L', 'LT', 'LITRE', 'LITRES', 'LITER', 'LITERS'],
  MTR: ['MTR', 'MTRS', 'M', 'METER', 'METERS', 'METRE', 'METRES', 'MT'],
  KG: ['KG', 'KGS', 'KILO', 'KILOS', 'KILOGRAM', 'KILOGRAMS'],
  SET: ['SET', 'SETS'],
  ROL: ['ROL', 'ROLL', 'ROLLS', 'RL'],
  REAM: ['REAM', 'REAMS', 'RM'],
  JOB: ['JOB', 'JOBS'],
  MON: ['MON', 'MONTH', 'MONTHS', 'MTH', 'MTHS'],
  QTR: ['QTR', 'QUARTER', 'QUARTERS', 'QTRS'],
  CYL: ['CYL', 'CYLINDER', 'CYLINDERS', 'CYLS'],
  BKT: ['BKT', 'BUCKET', 'BUCKETS', 'BKTS'],
  BRL: ['BRL', 'BARREL', 'BARRELS', 'BRLS'],
};

const LOOKUP = new Map<string, string>();
for (const [canon, list] of Object.entries(ALIASES)) for (const a of list) LOOKUP.set(a, canon);

export function canonicalUom(uom: string | null | undefined): string {
  const u = (uom ?? '').trim().toUpperCase();
  return LOOKUP.get(u) ?? u;
}

export function sameUom(a: string | null | undefined, b: string | null | undefined): boolean {
  return canonicalUom(a) === canonicalUom(b);
}
