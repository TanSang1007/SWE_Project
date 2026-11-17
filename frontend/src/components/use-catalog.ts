'use client';
import { useEffect, useState } from 'react';
import { CatalogError } from '../lib/api/products';
type State<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; kind: CatalogError['kind'] };
export function useCatalog<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<State<T>>({ status: 'loading' }); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending || controller.signal.aborted) return;
      pending = true;
      try {
        const data = await load(controller.signal);
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      } catch (error: unknown) {
        const kind = error instanceof CatalogError ? error.kind : 'unavailable';
        if (!controller.signal.aborted) setState(previous => previous.status === 'ready' && kind === 'unavailable' ? previous
          : { status: 'error', kind });
      } finally { pending = false; }
    }
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 20_000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [load, attempt]);
  function retry() { setState({ status: 'loading' }); setAttempt((value) => value + 1); }
  return { state, retry };
}
