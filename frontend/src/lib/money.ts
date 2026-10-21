const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
export function formatVnd(value: string): string {
  if (!/^(0|[1-9]\d{0,11})$/.test(value)) throw new Error('Invalid VND value');
  return vnd.format(BigInt(value));
}
