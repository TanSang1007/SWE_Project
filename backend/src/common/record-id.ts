import { isUUID } from 'class-validator';

// The shared development database also contains older sequence-based identities.
// New accounts/sessions still use UUIDs; both forms must resolve to the same rows.
export function isStoredId(value: unknown): value is string {
  return typeof value === 'string' && (isUUID(value) || /^[1-9]\d{0,19}$/.test(value));
}
