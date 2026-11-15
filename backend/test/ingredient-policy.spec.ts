import { Prisma } from '../src/generated/prisma/client';
import { quantity, stockStatus, uniqueLines, unitThreshold, ingredientThreshold } from '../src/ingredients/ingredient-policy';
test('quantity preserves exact decimals and does not silently round',()=>{expect(quantity('15.5','L').toFixed(3)).toBe('15.500');expect(quantity('0.001','KG').toFixed(3)).toBe('0.001');expect(()=>quantity('0.0001','L')).toThrow();expect(()=>quantity('1.1','PIECE')).toThrow();expect(()=>quantity('0','L',true)).toThrow();});
test.each([['PIECE','10','9'],['L','5','4.999'],['KG','10','9.999'],['EGG','10','9'],['BOTTLE','10','9'],['BAG','5','4']] as const)('fixed %s threshold; only strictly below warns', (unit,limit,below)=>{const threshold=unitThreshold(unit);expect(threshold.toString()).toBe(limit);expect(stockStatus(new Prisma.Decimal('0'),threshold)).toBe('OUT_OF_STOCK');expect(stockStatus(new Prisma.Decimal(below),threshold)).toBe('LOW_STOCK');expect(stockStatus(new Prisma.Decimal(limit),threshold)).toBe('IN_STOCK');expect(stockStatus(new Prisma.Decimal(limit).plus(1),threshold)).toBe('IN_STOCK');});
test('eggs are indivisible in receipts and actual counts',()=>{expect(quantity('12','EGG').toFixed(3)).toBe('12.000');expect(()=>quantity('1.5','EGG')).toThrow();});
test('bottles are indivisible in receipts and actual counts',()=>{expect(quantity('12','BOTTLE').toFixed(3)).toBe('12.000');expect(()=>quantity('1.5','BOTTLE')).toThrow();});
test('duplicate ingredient IDs cannot be hidden by UUID casing',()=>{expect(()=>uniqueLines([{ingredientId:'ABCD'},{ingredientId:'abcd'}])).toThrow();});

test('bags are indivisible in receipts and actual counts',()=>{expect(quantity('5','BAG').toFixed(3)).toBe('5.000');expect(()=>quantity('1.5','BAG')).toThrow();});

test.each([['Bột ca cao','KG','1'],['Bột matcha','KG','0.5'],['Bột quế','KG','0.1'],['Cà phê','KG','3'],['Sữa tươi','L','10'],['Sữa đặc','L','3'],['Đường','KG','5'],['Sốt caramel','BOTTLE','1'],['Đá','BAG','1']] as const)('file threshold for %s uses exact decimals and inclusive boundary', (name,unit,expected)=>{
  const t=ingredientThreshold(name,unit);expect(t.toString()).toBe(expected);
  expect(stockStatus(new Prisma.Decimal(0),t,true)).toBe('OUT_OF_STOCK');
  expect(stockStatus(t,t,true)).toBe('LOW_STOCK');expect(stockStatus(t.plus('0.001'),t,true)).toBe('IN_STOCK');
});
