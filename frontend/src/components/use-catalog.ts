'use client';
import { useEffect, useState } from 'react';
import { CatalogError } from '../lib/api/products';
type State<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; kind: CatalogError['kind'] };
export function useCatalog<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<State<T>>({ status: 'loading' }); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    function refresh() {
      if (inFlight || controller.signal.aborted || document.visibilityState === 'hidden') return;
      inFlight = true;
      void load(controller.signal).then(data => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setState(current => current.status === 'ready' ? current : { status: 'error', kind: error instanceof CatalogError ? error.kind : 'unavailable' });
      }).finally(() => { inFlight = false; });
    }
    refresh();
    const timer = window.setInterval(refresh, 20000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [load, attempt]);
  function retry() { setState({ status: 'loading' }); setAttempt((value) => value + 1); }
  return { state, retry };
}
