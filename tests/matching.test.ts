import { describe, expect, it } from 'vitest';
import { buildItemIndex, matchItem } from '@/engine/matching';
import type { Item } from '@/engine/types';

const items: Item[] = [
  ['ITM-1021', 'Ball bearing 6205-2RS'],
  ['ITM-1022', 'Ball bearing 6308-ZZ'],
  ['ITM-1023', 'Taper roller bearing 32210'],
  ['ITM-1009', 'Hex bolt M10x40 GR 8.8'],
  ['ITM-1014', 'Hex bolt M16x60 GR 10.9'],
  ['ITM-1010', 'Hex nut M10 GR 8'],
  ['ITM-1035', 'Hydraulic hose 1/2 inch 2 wire'],
  ['ITM-1036', 'Pneumatic cylinder 50x100'],
  ['ITM-1039', 'FRL unit 1/2 inch'],
  ['ITM-1057', '24 inch monitor'],
  ['ITM-1015', 'Welding electrode E6013 3.15mm'],
  ['ITM-1048', 'Nitrile coated gloves'],
  ['ITM-1047', 'Cotton hand gloves'],
  ['ITM-1071', 'EOT crane 5 ton'],
  ['ITM-1066', 'CMM calibration service'],
  ['ITM-1065', 'Calibration of vernier & micrometers'],
].map(([code, description]) => ({ code, description, uom: 'NOS', category: 'X', itemType: 'Material', standardPrice: 1 }));

const index = buildItemIndex(items);
const opts = { minScore: 0.7, minMargin: 0.05, useRequesterCode: true };
const m = (text: string, code = '') => matchItem(code, text, index, opts);

describe('item matching (1.1)', () => {
  it.each([
    ['brg 6205 2rs', 'ITM-1021'],
    ['brg 6308 ZZ for maintenance', 'ITM-1022'],
    ['taper roller brg 32210', 'ITM-1023'],
    ['hyd hose 1/2 inch 2 wire', 'ITM-1035'],
    ['pneu cylinder 50x100', 'ITM-1036'],
    ['FRL unit 1/2 inch as per sample', 'ITM-1039'],
    ['monitor 24"', 'ITM-1057'],
    ['welding rod e6013 3.15mm', 'ITM-1015'],
    ['nitrile coated gloves - urgent', 'ITM-1048'],
    ['eot crane 5 ton', 'ITM-1071'],
    ['hex nut m10 gr 8', 'ITM-1010'],
    ['CMM calibration service', 'ITM-1066'],
  ])('matches "%s" to %s', (text, code) => {
    const r = m(text);
    expect(r.itemCode).toBe(code);
  });

  it('uses a valid requester item code as given', () => {
    expect(m('anything', 'itm-1009').itemCode).toBe('ITM-1009');
  });

  it('does not invent items for unknown requests', () => {
    expect(m('Drinking water purifier 50 LPH').itemCode).toBeNull();
    expect(m('Ultrasonic thickness gauge').itemCode).toBeNull();
    expect(m('office chair ergonomic').itemCode).toBeNull();
  });

  it('does not match a different size variant', () => {
    expect(m('hex bolt M12x50').itemCode).toBeNull();
    expect(m('ball bearing 6206 zz').itemCode).toBeNull();
  });

  it('treats a vague request as new or ambiguous rather than guessing', () => {
    const r = m('gloves');
    expect(r.itemCode).toBeNull();
    expect(r.candidates.map((c) => c.itemCode)).toEqual(expect.arrayContaining(['ITM-1048', 'ITM-1047']));
  });
});
