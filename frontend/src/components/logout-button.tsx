'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { logoutSession } from '../lib/auth-session';

// Logout always asks for confirmation first, in both customer and operations layouts.
export function LogoutButton({ email, onLoggedOut }: { email?: string; onLoggedOut?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    keepButton.current?.focus();
  }, [open]);

  function close() {
    if (busy) return;
    dialog.current?.close();
    setOpen(false);
    setError('');
  }

  async function confirm() {
    setBusy(true); setError('');
    try {
      await logoutSession();
      dialog.current?.close();
      setOpen(false);
      onLoggedOut?.();
    } catch {
      setError('Chưa đăng xuất được. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="nav-button" type="button" onClick={() => setOpen(true)}>Đăng xuất</button>
    {open && <dialog ref={dialog} className="logout-dialog" aria-labelledby={headingId}
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <h2 id={headingId}>Bạn có muốn đăng xuất không?</h2>
      {email && <p>Tài khoản hiện tại: <strong>{email}</strong></p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="logout-dialog-actions">
        <button ref={keepButton} type="button" className="logout-cancel" disabled={busy} onClick={close}>Ở lại</button>
        <button type="button" className="button logout-confirm" disabled={busy} onClick={() => void confirm()}>{busy ? 'Đang đăng xuất…' : 'Đăng xuất'}</button>
      </div>
    </dialog>}
  </>;
}
