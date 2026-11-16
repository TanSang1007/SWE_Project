import type { NextConfig } from 'next';

// Next loads frontend/.env*, not the repository root .env. Public variables
// must be available when Next compiles the browser bundle, including dev.
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  ?? (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3001' : undefined);

const nextConfig: NextConfig = {
  async rewrites() {
    const internalBase = process.env.API_INTERNAL_BASE_URL ?? 'http://127.0.0.1:3001';
    return [
      { source: '/api/auth/:path*', destination: `${internalBase}/auth/:path*` },
      { source: '/payments/vnpay/return', destination: `${internalBase}/payments/vnpay/return` },
      { source: '/payments/vnpay/ipn', destination: `${internalBase}/payments/vnpay/ipn` },
    ];
  },
  env: apiBaseUrl ? { NEXT_PUBLIC_API_BASE_URL: apiBaseUrl } : {},
};
export default nextConfig;
