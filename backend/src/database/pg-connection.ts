// adapter-pg serializes Date parameters as UTC wall time. Fix the session timezone
// consistently for both reads and writes; retain scoped search_path/other options.
export function utcConnectionString(connectionString: string, sessionOptions = '') {
  const url = new URL(connectionString);
  url.searchParams.set('options', [url.searchParams.get('options'), sessionOptions, '-c TimeZone=UTC'].filter(Boolean).join(' '));
  return url.toString();
}
