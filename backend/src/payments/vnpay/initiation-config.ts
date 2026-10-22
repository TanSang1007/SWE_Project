import { parseVnpayConfig, type VnpayConfig } from './vnpay-config';
export function initiationSettings(values: Record<string, unknown>): {
    PAYMENT_PROVIDER_MODE: 'MOCK' | 'VNPAY_SANDBOX';
    VNPAY_INITIATION_CONFIG: VnpayConfig | null;
    VNPAY_ACCEPT_NEW_PAYMENTS?: boolean;
    VNPAY_SANDBOX_ENABLED?: boolean;
} {
    const mode = values.PAYMENT_PROVIDER_MODE ?? 'MOCK';
    if (mode === 'MOCK')
        return { PAYMENT_PROVIDER_MODE: mode, VNPAY_INITIATION_CONFIG: null };
    if (mode !== 'VNPAY_SANDBOX')
        throw Error('Invalid PAYMENT_PROVIDER_MODE');
    const accept = values.VNPAY_ACCEPT_NEW_PAYMENTS;
    if (accept !== undefined && accept !== 'true' && accept !== 'false' && typeof accept !== 'boolean')
        throw Error('Invalid VNPAY acceptance configuration');
    const env = Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    if (values.NODE_ENV === 'development') {
        if (values.VNPAY_SANDBOX_ENABLED !== 'true' && values.VNPAY_SANDBOX_ENABLED !== true)
            throw Error('VNPAY Sandbox requires explicit development opt-in');
        if (values.VNPAY_INITIATION_TEST_ONLY !== undefined && values.VNPAY_INITIATION_TEST_ONLY !== 'false')
            throw Error('Incompatible VNPAY test configuration');
        let database: URL;
        try { database = new URL(String(values.DATABASE_URL)); } catch { throw Error('Invalid Sandbox database'); }
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname);
        const neon = database.hostname.endsWith('.neon.tech') && database.hostname.includes('-pooler.')
            && database.pathname === '/brewlite_dev' && ['require', 'verify-full'].includes(database.searchParams.get('sslmode') ?? '');
        if (!['postgresql:', 'postgres:'].includes(database.protocol) || !(local || neon))
            throw Error('Sandbox development requires a local database or TLS pooled Neon brewlite_dev');
        if (Number(values.PORT ?? 3001) !== 3001 || (values.FRONTEND_ORIGIN ?? 'http://localhost:3000') !== 'http://localhost:3000'
            || (values.VNPAY_RESULT_URL !== undefined && values.VNPAY_RESULT_URL !== 'http://localhost:3000/payments/vnpay/result')
            || (values.VNPAY_ATTEMPT_TTL_SECONDS !== undefined && values.VNPAY_ATTEMPT_TTL_SECONDS !== '600'))
            throw Error('Invalid local Sandbox result or validity configuration');
        return { PAYMENT_PROVIDER_MODE: mode, VNPAY_INITIATION_CONFIG: parseVnpayConfig(env), VNPAY_SANDBOX_ENABLED: true,
            VNPAY_ACCEPT_NEW_PAYMENTS: accept === 'true' || accept === true };
    }
    // Production is never accepted; the original isolated synthetic branch is retained.
    const deny = () => Error('VNPAY initiation requires controlled synthetic test configuration');
    if (values.NODE_ENV !== 'test' || values.VNPAY_INITIATION_TEST_ONLY !== 'true'
        || typeof values.DATABASE_URL !== 'string' || values.TEST_DATABASE_URL !== values.DATABASE_URL)
        throw deny();
    let db: URL;
    try {
        db = new URL(values.DATABASE_URL);
    }
    catch {
        throw deny();
    }
    if (!['postgresql:', 'postgres:'].includes(db.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(db.hostname)
        || !/^\/brewlite_b2a_[a-f0-9]{12}_test$/.test(db.pathname))
        throw deny();
    const config = parseVnpayConfig(env);
    if (config.merchantCode !== 'TEST0001' || !config.hashSecret.startsWith('synthetic-b2a-')
        || new URL(config.returnUrl).hostname !== 'callback.example.org'
        || (values.VNPAY_ATTEMPT_TTL_SECONDS !== undefined && values.VNPAY_ATTEMPT_TTL_SECONDS !== '600'))
        throw deny();
    return { PAYMENT_PROVIDER_MODE: mode, VNPAY_INITIATION_CONFIG: config,
        VNPAY_ACCEPT_NEW_PAYMENTS: accept === undefined || accept === 'true' || accept === true };
}
