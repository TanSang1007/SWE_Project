'use client';
import { useEffect, useState } from 'react';
import { CatalogError } from '../lib/api/products';
type State<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; kind: CatalogError['kind'] };
export function useCatalog<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<State<T>>({ status: 'loading' }); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ status: 'ready', data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ status: 'error', kind: error instanceof CatalogError ? error.kind : 'unavailable' });
    });
    return () => controller.abort();
  }, [load, attempt]);
  function retry() { setState({ status: 'loading' }); setAttempt((value) => value + 1); }
  return { state, retry };
}
