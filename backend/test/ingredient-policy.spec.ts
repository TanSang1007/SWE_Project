import { Prisma } from '../src/generated/prisma/client';
import { quantity, stockStatus, uniqueLines, unitThreshold, ingredientThreshold } from '../src/ingredients/ingredient-policy';
test('quantity preserves exact decimals and does not silently round',()=>{expect(quantity('15.5','L').toFixed(3)).toBe('15.500');expect(quantity('0.001','KG').toFixed(3)).toBe('0.001');expect(()=>quantity('0.0001','L')).toThrow();expect(()=>quantity('1.1','PIECE')).toThrow();expect(()=>quantity('0','L',true)).toThrow();});
test.each([['PIECE','10','9'],['L','2','1.999'],['KG','3','2.999'],['EGG','10','9'],['BOTTLE','10','9'],['BAG','5','4']] as const)('fixed %s threshold; only strictly below warns', (unit,limit,below)=>{const threshold=unitThreshold(unit);expect(threshold.toString()).toBe(limit);expect(stockStatus(new Prisma.Decimal('0'),threshold)).toBe('OUT_OF_STOCK');expect(stockStatus(new Prisma.Decimal(below),threshold)).toBe('LOW_STOCK');expect(stockStatus(new Prisma.Decimal(limit),threshold)).toBe('IN_STOCK');expect(stockStatus(new Prisma.Decimal(limit).plus(1),threshold)).toBe('IN_STOCK');});
test('eggs are indivisible in receipts and actual counts',()=>{expect(quantity('12','EGG').toFixed(3)).toBe('12.000');expect(()=>quantity('1.5','EGG')).toThrow();});
test('bottles are indivisible in receipts and actual counts',()=>{expect(quantity('12','BOTTLE').toFixed(3)).toBe('12.000');expect(()=>quantity('1.5','BOTTLE')).toThrow();});
test('duplicate ingredient IDs cannot be hidden by UUID casing',()=>{expect(()=>uniqueLines([{ingredientId:'ABCD'},{ingredientId:'abcd'}])).toThrow();});

test('bags are indivisible in receipts and actual counts',()=>{expect(quantity('5','BAG').toFixed(3)).toBe('5.000');expect(()=>quantity('1.5','BAG')).toThrow();});

test.each([['Sốt caramel','BOTTLE','1'],['Đá','BAG','1']] as const)('other units retain the inclusive threshold for %s', (name,unit,expected)=>{
  const t=ingredientThreshold(name,unit);expect(t.toString()).toBe(expected);
  expect(stockStatus(new Prisma.Decimal(0),t,true)).toBe('OUT_OF_STOCK');
  expect(stockStatus(t,t,true)).toBe('LOW_STOCK');expect(stockStatus(t.plus('0.001'),t,true)).toBe('IN_STOCK');
});

test.each([['Bột ca cao','KG','3'],['Bột matcha','KG','3'],['Bột quế','KG','3'],['Cà phê','KG','3'],['Đường','KG','3'],['Nguyên liệu mới','KG','3'],['Đá viên (công thức)','KG','3'],['Sữa tươi','L','2'],['Sữa đặc','L','2'],['Sữa tươi (công thức)','L','2'],['Nguyên liệu mới','L','2']] as const)('%s uses the unit warning instead of older name overrides', (name,unit,expected)=>{
  const t=ingredientThreshold(name,unit);
  expect(t.toString()).toBe(expected);
  expect(stockStatus(t.minus('0.001'),t)).toBe('LOW_STOCK');
  expect(stockStatus(t,t)).toBe('IN_STOCK');
});
