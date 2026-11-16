import { Prisma } from '../src/generated/prisma/client';
import { countVariance, inventoryDayStart, reconciledCountQuantity, supportsInventoryCount } from '../src/ingredients/inventory-control';
const decimal = (value: string) => new Prisma.Decimal(value);

test('daily period follows Vietnam midnight across UTC day/year boundaries', () => {
  expect(inventoryDayStart(new Date('2026-11-13T16:59:59Z')).toISOString()).toBe('2026-11-12T17:00:00.000Z');
  expect(inventoryDayStart(new Date('2026-11-13T17:00:00Z')).toISOString()).toBe('2026-11-13T17:00:00.000Z');
  expect(inventoryDayStart(new Date('2026-12-31T18:00:00Z')).toISOString()).toBe('2026-12-31T17:00:00.000Z');
});
test.each([['9.700','SHORTAGE','3.000','WITHIN_THRESHOLD'],['10.300','SURPLUS','3.000','WITHIN_THRESHOLD'],['9.699','SHORTAGE','3.010','ABNORMAL'],['10','MATCHED','0.000','MATCHED']])(
  'variance for actual %s uses consumption, direction and inclusive threshold', (actual,kind,percent,status) => {
    expect(countVariance(decimal(actual),decimal('10'),decimal('10'),decimal('3'),null)).toMatchObject({differenceKind:kind,variancePercent:percent,controlStatus:status});
  });
test('no consumption uses absolute difference without division by zero', () => {
  expect(countVariance(decimal('9.9'),decimal('10'),decimal('0'),decimal('3'),decimal('0.1'))).toMatchObject({variancePercent:null,controlStatus:'WITHIN_THRESHOLD'});
  expect(countVariance(decimal('9.899'),decimal('10'),decimal('0'),decimal('3'),decimal('0.1'))).toMatchObject({variancePercent:null,controlStatus:'ABNORMAL'});
});

test.each([
  { grams: 22, actualStock: '2.800', difference: '-0.200', percent: '10.000', status: 'WITHIN_THRESHOLD' },
  { grams: 23, actualStock: '2.700', difference: '-0.300', percent: '15.000', status: 'WITHIN_THRESHOLD' },
  { grams: 24, actualStock: '2.600', difference: '-0.400', percent: '20.000', status: 'ABNORMAL' },
])('cacao at $grams g per serving is compared with the 20 g standard through period counts', ({ actualStock, difference, percent, status }) => {
  // Starting at 5 kg, 100 servings consume 2 kg by recipe, leaving 3 kg.
  // A synthetic 15% threshold evaluates the discrepancy against consumption,
  // rather than the remaining stock, without changing the standard dose.
  expect(countVariance(decimal(actualStock), decimal('3'), decimal('2'), decimal('15'), null, 'KG')).toEqual({
    difference, differenceKind: 'SHORTAGE', variancePercent: percent, controlStatus: status,
  });
});
test('counted supplies use quantities even when a consumption denominator exists', () => {
  expect(countVariance(decimal('99'),decimal('100'),decimal('1'),null,decimal('1'),'PIECE')).toMatchObject({variancePercent:null,controlStatus:'WITHIN_THRESHOLD'});
});
test('missing thresholds are explicit and never approve or discard a discrepancy', () => {
  expect(countVariance(decimal('9'),decimal('10'),decimal('2'),null,null)).toMatchObject({difference:'-1.000',variancePercent:'50.000',controlStatus:'UNCONFIGURED'});
});
test('variance covers materials only, excluding ice, water and reusable supplies', () => {
  for(const name of ['Đá','Đá viên',' ĐÁ  VIÊN (công thức) ','Nước lọc (công thức)'])expect(supportsInventoryCount({name,unit:'KG'})).toBe(false);
  expect(supportsInventoryCount({name:'Ly sứ (công thức)',unit:'PIECE'})).toBe(false);
  expect(supportsInventoryCount({name:'Sữa tươi không đường (công thức)',unit:'L'})).toBe(true);
});
const movement = (before:string,delta:string,sequence=1n,countLineId:string|null=null) => ({sequence,beforeQuantity:decimal(before),delta:decimal(delta),afterQuantity:decimal(before).plus(delta),countLineId});
test('approval applies only the counted difference after receipts and consumption', () => {
  expect(reconciledCountQuantity(decimal('10'),decimal('8'),decimal('27'),decimal('3'),[movement('10','20'),movement('30','-3',2n)]).toFixed(3)).toBe('25.000');
});
test('reserve/release journal entries preserve physical stock while reservations constrain approval', () => {
  expect(reconciledCountQuantity(decimal('10'),decimal('8'),decimal('10'),decimal('7'),[movement('10','0')]).toFixed(3)).toBe('8.000');
  expect(()=>reconciledCountQuantity(decimal('10'),decimal('6'),decimal('10'),decimal('7'),[movement('10','0')])).toThrow();
});
test.each([
  { entries: [movement('10','20'),movement('30','-2',2n,'another-count')] },
  { entries: [movement('9','20')] },
  { entries: [] },
])('incomplete journal or a later count cannot silently reapply a discrepancy', ({entries}) => {
  expect(()=>reconciledCountQuantity(decimal('10'),decimal('8'),decimal('28'),decimal('0'),entries)).toThrow();
});
