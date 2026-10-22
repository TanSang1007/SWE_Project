// adapter-pg serializes Date parameters as UTC wall time. Fix the session timezone
// consistently for both reads and writes; retain scoped search_path/other options.
export function utcConnectionString(connectionString: string, sessionOptions = '') {
  const url = new URL(connectionString);
  url.searchParams.set('options', [url.searchParams.get('options'), sessionOptions, '-c TimeZone=UTC'].filter(Boolean).join(' '));
  return url.toString();
}

// Neon adds network round trips between statements. Keep SQL lock/statement
// limits unchanged; allow a bounded total transaction deadline for remote I/O.
export function transactionOptions(connectionString: string) {
  const url = new URL(connectionString);
  return url.hostname.endsWith('.neon.tech')
    ? { maxWait: 2000, timeout: 5000 }
    : { maxWait: 50, timeout: 400 };
}
