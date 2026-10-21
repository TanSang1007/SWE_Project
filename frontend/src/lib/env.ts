export function getApiBaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!value) throw new Error('NEXT_PUBLIC_API_BASE_URL is required for API requests.');
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_API_BASE_URL must be an HTTP(S) URL.');
  }
  return value.replace(/\/$/, '');
}
