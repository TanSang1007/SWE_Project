'use client';
import Link from 'next/link';
import { useNotificationStore } from '../lib/notification-store';

export function NotificationHost() {
  const toasts = useNotificationStore((s) => s.toasts);
  const popup = useNotificationStore((s) => s.popup);
  const dismissToast = useNotificationStore((s) => s.dismissToast);
  const closePopup = useNotificationStore((s) => s.closePopup);

  return (
    <>
      {toasts.length > 0 && (
        <aside className="brew-toast-stack" aria-live="polite" aria-label="Thông báo nhanh">
          {toasts.map((t) => (
            <div key={t.id} className={`brew-toast brew-toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
              <span className="brew-toast-icon" aria-hidden="true">
                {t.tone === 'success' ? '✓' : t.tone === 'error' ? '!' : t.tone === 'warning' ? '⚠' : 'ℹ'}
              </span>
              <div className="brew-toast-body">
                <strong>{t.title}</strong>
                {t.message && <p>{t.message}</p>}
              </div>
              <button
                type="button"
                className="brew-toast-close"
                aria-label="Đóng thông báo"
                onClick={() => dismissToast(t.id)}
              >
                ×
              </button>
            </div>
          ))}
        </aside>
      )}

      {popup && (
        <div
          className="brew-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="brew-modal-title"
          onClick={closePopup}
        >
          <div
            className={`brew-modal-card brew-modal-${popup.tone}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="brew-modal-dismiss"
              aria-label="Đóng"
              onClick={closePopup}
            >
              ×
            </button>
            <div className={`brew-modal-badge brew-modal-badge-${popup.tone}`} aria-hidden="true">
              {popup.tone === 'success' ? '✓' : popup.tone === 'error' ? '✕' : '!'}
            </div>
            <h2 id="brew-modal-title" className="brew-modal-title">
              {popup.title}
            </h2>
            {popup.message && <p className="brew-modal-message">{popup.message}</p>}
            {(popup.orderCode || popup.total) && (
              <div className="brew-modal-meta">
                {popup.orderCode && (
                  <div>
                    <span>Mã đơn hàng</span>
                    <strong>{popup.orderCode}</strong>
                  </div>
                )}
                {popup.total && (
                  <div>
                    <span>Tổng thanh toán</span>
                    <strong>{popup.total}</strong>
                  </div>
                )}
              </div>
            )}
            <div className="brew-modal-actions">
              {popup.actions && popup.actions.length > 0 ? (
                popup.actions.map((act, idx) =>
                  act.href ? (
                    <Link
                      key={idx}
                      href={act.href}
                      className={`brew-btn brew-btn-${act.variant ?? 'primary'}`}
                      onClick={() => {
                        act.onClick?.();
                        closePopup();
                      }}
                    >
                      {act.label}
                    </Link>
                  ) : (
                    <button
                      key={idx}
                      type="button"
                      className={`brew-btn brew-btn-${act.variant ?? 'primary'}`}
                      onClick={() => {
                        act.onClick?.();
                        closePopup();
                      }}
                    >
                      {act.label}
                    </button>
                  ),
                )
              ) : (
                <button type="button" className="brew-btn brew-btn-primary" onClick={closePopup}>
                  Đóng
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
