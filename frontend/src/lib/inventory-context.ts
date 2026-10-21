import type { InventoryContext } from '../types/admin-inventory';
const storageKey = 'brewlite-inventory-request';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readInventoryContext(userId: string): InventoryContext | null {
  try {
    const text = sessionStorage.getItem(storageKey); if (!text) return null;
    const c = JSON.parse(text) as InventoryContext;
    if (!c || c.userId !== userId || !uuid.test(c.productId) || !uuid.test(c.key)
      || !c.body || !Number.isInteger(c.body.delta) || !c.body.delta || Math.abs(c.body.delta) > 2147483647
      || !Number.isInteger(c.body.expectedVersion) || c.body.expectedVersion < 0 || c.body.expectedVersion > 2147483647) {
      clearInventoryContext(); return null;
    }
    return { userId: c.userId, productId: c.productId, key: c.key, body: { delta: c.body.delta, expectedVersion: c.body.expectedVersion } };
  } catch { return null; }
}
export function saveInventoryContext(context: InventoryContext): boolean {
  try { sessionStorage.setItem(storageKey, JSON.stringify(context)); return sessionStorage.getItem(storageKey) === JSON.stringify(context); } catch { return false; }
}
export function clearInventoryContext() { try { sessionStorage.removeItem(storageKey); } catch { /* Block new writes if storage cannot persist them. */ } }
