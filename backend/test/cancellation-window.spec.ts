import { assertPaidCancellation, assertPreparationReady, cancellationWindow } from '../src/orders/cancellation-window';
const paidAt = new Date('2026-11-15T10:00:00Z');
const order = { status: 'PAID', paidAt };
test.each([30,119,119.999])('a paid order can be cancelled at %s seconds but cannot start preparation', seconds => {
  const now = new Date(paidAt.getTime() + seconds * 1000);
  expect(cancellationWindow(order,now)).toEqual({cancelUntil:'2026-11-15T10:02:00.000Z',canCancelPaid:true,canStartPreparing:false});
  expect(()=>assertPaidCancellation(order,now)).not.toThrow();
  expect(()=>assertPreparationReady(order,now)).toThrow();
});
test.each([120,121,600])('the boundary at %s seconds permits only Staff preparation',seconds=>{
  const now = new Date(paidAt.getTime()+seconds*1000);
  expect(cancellationWindow(order,now)).toMatchObject({canCancelPaid:false,canStartPreparing:true});
  expect(()=>assertPaidCancellation(order,now)).toThrow();
  expect(()=>assertPreparationReady(order,now)).not.toThrow();
});
test.each(['PENDING','PAYMENT_FAILED','CANCELLED','PREPARING','READY','COMPLETED'])('state %s never reopens paid cancellation or preparation',status=>{
  expect(cancellationWindow({status,paidAt},new Date(paidAt.getTime()+30000)).canCancelPaid).toBe(false);
  expect(cancellationWindow({status,paidAt},new Date(paidAt.getTime()+150000)).canStartPreparing).toBe(false);
});
test('missing or future paidAt cannot start a timer; reading does not change order state',()=>{
  expect(cancellationWindow({status:'PAID',paidAt:null})).toEqual({cancelUntil:null,canCancelPaid:false,canStartPreparing:false});
  expect(cancellationWindow(order,new Date(paidAt.getTime()-1)).canCancelPaid).toBe(false);
  cancellationWindow(order,new Date(paidAt.getTime()+150000));expect(order.status).toBe('PAID');
});
