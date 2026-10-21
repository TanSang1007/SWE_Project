import { PaymentResult } from '../../../../components/payment-result';
import { uuid } from '../../../../lib/api/gateway-payments';
export default async function PaymentResultPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const valid = Object.keys(params).length === 1 && uuid(params.attemptId);
  const attemptId = valid ? (params.attemptId as string).toLowerCase() : undefined;
  return <PaymentResult key={attemptId ?? 'invalid'} attemptId={attemptId} />;
}
