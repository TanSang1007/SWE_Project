'use client';
import Link from 'next/link';
export function CatalogLoading({ detail = false }: { detail?: boolean }) {
  return <section className="state-panel" role="status" aria-live="polite"><div className="loading-mark" aria-hidden="true" />
    <h2>{detail ? 'Đang tải chi tiết món…' : 'Đang tải thực đơn…'}</h2><p>Đợi một chút, BrewLite đang chuẩn bị thông tin cho bạn.</p></section>;
}
export function CatalogState({ kind, retry }: { kind: 'empty' | 'invalid-id' | 'not-found' | 'unavailable'; retry?: () => void }) {
  const messages = {
    empty: ['Thực đơn đang được cập nhật', 'Hiện chưa có đồ uống để hiển thị. Bạn ghé lại sau nhé.'],
    'invalid-id': ['Đường dẫn món chưa hợp lệ', 'Hãy trở về thực đơn để chọn một đồ uống.'],
    'not-found': ['Không tìm thấy món này', 'Món bạn tìm không có trong thực đơn hiện tại.'],
    unavailable: ['Chưa tải được thực đơn', 'Kết nối đang gián đoạn. Bạn thử lại sau một chút nhé.'],
  };
  const [title, message] = messages[kind];
  return <section className="state-panel" role={kind === 'empty' ? 'status' : 'alert'}><p className="eyebrow">BrewLite</p><h2>{title}</h2><p>{message}</p>
    {retry && <button type="button" className="button" onClick={retry}>Thử lại</button>}
    {(kind === 'invalid-id' || kind === 'not-found') && <Link className="button" href="/">Về thực đơn</Link>}</section>;
}
