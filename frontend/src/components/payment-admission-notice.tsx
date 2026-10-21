export function PaymentAdmissionNotice({ closed }: { closed: boolean }) {
  if (!closed) return null;
  return <p role="status">Thanh toán VNPAY hiện đang tạm ngừng nhận giao dịch mới. Giỏ hàng được giữ nguyên. Bạn vẫn có thể xem trạng thái đơn hiện tại; chỉ có thể đặt hoặc thanh toán đơn có tiền khi hệ thống mở nhận giao dịch trở lại.</p>;
}
