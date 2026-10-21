import { Prisma } from '../src/generated/prisma/client';
import { validateZeroSnapshot, ZeroConfirmationService } from '../src/payments/zero-confirmation.service';
import { PrismaService } from '../src/database/prisma.service';
type Snapshot = Parameters<typeof validateZeroSnapshot>[0];
const decimal = (n: string | number) => new Prisma.Decimal(n);
function snapshot(): Snapshot {
  return { total: decimal(0), subtotal: decimal(100000), discountAmount: decimal(10000), loyaltyDiscountAmount: decimal(90000), redeemedPoints: 900,
    redemptionState: 'RESERVED', reservationCycle: 1, items: [{ qty: 1, basePrice: decimal(100000), sizeExtraPrice: decimal(0), unitPrice: decimal(100000), lineTotal: decimal(100000), toppings: [] }] } as unknown as Snapshot;
}
test('stored zero arithmetic with redemption is eligible without catalog repricing', () => { expect(() => validateZeroSnapshot(snapshot())).not.toThrow(); });
test('promotion-only zero requires NONE/cycle0 and no redemption', () => {
  const o = snapshot(); o.discountAmount = decimal(100000); o.loyaltyDiscountAmount = decimal(0); o.redeemedPoints = 0; o.redemptionState = 'NONE'; o.reservationCycle = 0;
  expect(() => validateZeroSnapshot(o)).not.toThrow();
});
test.each(['1', '-1', '0.0001', '-0.0001', 'NaN', 'Infinity'])('exact total guard rejects %s', total => {
  expect(() => validateZeroSnapshot({ ...snapshot(), total: decimal(total) })).toThrow();
});
test.each(['subtotal', 'discount', 'redemption', 'state', 'cycle', 'noitems', 'unit', 'line', 'qty', 'negativebase', 'negativeextra', 'topping', 'fraction'])('corrupt %s snapshot fails closed', kind => {
  const o = snapshot();
  switch (kind) {
    case 'subtotal': o.subtotal = decimal(100001); break;
    case 'discount': o.discountAmount = decimal(-1); break;
    case 'redemption': o.loyaltyDiscountAmount = decimal(89999); break;
    case 'state': o.redemptionState = 'SETTLED'; break;
    case 'cycle': o.reservationCycle = 2; break;
    case 'noitems': o.items = []; break;
    case 'unit': o.items[0].unitPrice = decimal(99999); break;
    case 'line': o.items[0].lineTotal = decimal(99999); break;
    case 'qty': o.items[0].qty = 0; break;
    case 'negativebase': o.items[0].basePrice = decimal(-1); break;
    case 'negativeextra': o.items[0].sizeExtraPrice = decimal(-1); break;
    case 'topping': o.items[0].toppings = [{ priceSnapshot: decimal(1) }] as Snapshot['items'][number]['toppings']; break;
    case 'fraction': o.items[0].basePrice = decimal('99999.5'); o.items[0].sizeExtraPrice = decimal('0.5'); break;
  }
  expect(() => validateZeroSnapshot(o)).toThrow();
});
test.each([undefined, '', 'contains space', 'x'.repeat(129)])('invalid idempotency key rejects before DB', async key => {
  const work = jest.fn(); const service = new ZeroConfirmationService({ $transaction: work } as unknown as PrismaService);
  await expect(service.confirm('owner', key, 'order')).rejects.toMatchObject({ status: 400 }); expect(work).not.toHaveBeenCalled();
});
