// Sessions created before the current BrewLite run are not restorable.
// `npm run dev` passes one timestamp for the whole run so backend restarts
// inside the same run (restart-backend/drain/recover) keep users signed in;
// without it, the backend process start time is the cutoff.
const processStartedAt = new Date();

function parse(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function sessionCutoff(): Date {
  return parse(process.env.BREWLITE_RUNTIME_STARTED_AT) ?? processStartedAt;
}
