import { OrderError } from './api/orders';
import type { Order } from '../types/order';
export const unpaid = (order: Order | null) => !!order && ['PENDING', 'PAYMENT_FAILED'].includes(order.status);
export function checkoutStatusMessage(status: Order['status']) {
  return { PENDING: 'Đơn chưa thanh toán. Hãy kiểm tra tổng đơn trước khi xác nhận trả tiền.',
    PAYMENT_FAILED: 'Thanh toán thất bại. Giỏ được giữ nguyên. Bạn có thể thử lại hoặc hủy đơn.',
    PAID: 'Thanh toán thành công.', CANCELLED: 'Đơn đã hủy. Bạn có thể chỉnh sửa giỏ và đặt đơn mới.',
    PREPARING: 'Đơn đã thanh toán và đang được pha chế.', READY: 'Đơn đã sẵn sàng nhận tại quầy.', COMPLETED: 'Đơn đã hoàn tất.' }[status];
}
export function checkoutErrorMessage(error: unknown, operation: 'create' | 'payment' | 'cancel' | 'refresh') {
  const code = error instanceof OrderError ? error.code : 'UNAVAILABLE';
  if (code === 'PAYMENT_ADMISSION_CLOSED') return 'VNPAY đang tạm ngừng nhận thanh toán mới. Vui lòng giữ nguyên giỏ hàng và kiểm tra lại sau.';
  if (code === 'VNPAY_MINIMUM_AMOUNT_NOT_MET') return 'Thanh toán VNPAY yêu cầu số tiền tối thiểu 5.000đ. Vui lòng điều chỉnh giỏ hàng hoặc số điểm sử dụng.';
  if (code === 'LOYALTY_INSUFFICIENT_POINTS') return 'Điểm khả dụng không đủ. Số điểm đã chọn được giữ nguyên; hãy tải lại và chọn lại.';
  if (code === 'LOYALTY_REDEMPTION_EXCEEDS_TOTAL') return 'Điểm đã chọn vượt tổng tiền sau giảm giá. Hãy chọn lại số điểm.';
  if (code === 'LOYALTY_REVERSAL_OUTSTANDING') return 'Bạn còn nghĩa vụ thu hồi điểm. Hủy đơn chưa thanh toán để giải phóng điểm; sau đó có thể đặt đơn không dùng điểm.';
  if (code === 'UNAUTHORIZED') return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục với đơn và giỏ đã lưu.';
  if (code === 'ORDER_NOT_FOUND') return 'Không tìm thấy đơn của bạn. Kiểm tra tài khoản đăng nhập và tải lại đơn.';
  if (code === 'OUT_OF_STOCK') return operation === 'payment' ? 'Không đủ tồn kho để thử lại thanh toán. Đơn và giỏ vẫn được giữ; hãy thử lại sau hoặc hủy đơn.' : 'Không đủ tồn kho. Giỏ vẫn được giữ nguyên; hãy kiểm tra số lượng trước khi đặt lại.';
  if (code === 'PRODUCT_UNAVAILABLE') return 'Món đã ngừng bán. Giỏ vẫn được giữ nguyên; hãy điều chỉnh hoặc xóa dòng này trước khi đặt đơn mới.';
  if (code === 'CONCURRENT_UPDATE') return 'Giỏ hoặc tồn kho đã thay đổi. Hãy tải lại, kiểm tra số lượng và xác nhận lại.';
  if (code === 'INVALID_ITEM_OPTIONS') return 'Tùy chọn món không còn hợp lệ. Giỏ vẫn được giữ; hãy chọn lại size hoặc topping.';
  if (code === 'PROMOTION_INVALID') return 'Mã giảm giá không hợp lệ hoặc chưa đủ điều kiện. Kiểm tra mã và tổng giỏ trước khi đặt lại.';
  if (code === 'VALIDATION_ERROR' || code === 'MISSING_IDEMPOTENCY_KEY') return 'Yêu cầu chưa hợp lệ. Kiểm tra giỏ và tải lại đơn trước khi tiếp tục.';
  if (code === 'INVALID_ORDER_STATE') return 'Bạn đang có đơn chưa hoàn tất hoặc trạng thái đơn không cho phép thao tác này. Hãy mở / tải lại đơn hiện tại; chỉ đơn chưa thanh toán mới có thể hủy.';
  if (code === 'ORDER_ALREADY_PAID') return 'Đơn đã thanh toán. Hãy tải lại trạng thái hiện tại.';
  if (code === 'IDEMPOTENCY_KEY_REUSED') return 'Yêu cầu đã lưu có nội dung khác. Hãy tải lại đơn; không gửi một yêu cầu thanh toán mới khi chưa rõ kết quả.';
  if (code === 'RETRY_CONTEXT_UNAVAILABLE') return 'Trình duyệt chưa lưu được yêu cầu để phục hồi. Hãy cho phép lưu dữ liệu trong tab rồi thử lại; yêu cầu chưa được gửi.';
  if (operation === 'refresh') return 'Chưa tải được trạng thái đơn. Hãy thử tải lại; giỏ và yêu cầu đã lưu vẫn được giữ.';
  if (operation === 'cancel') return 'Chưa xác nhận được kết quả hủy. Hãy tải lại đơn trước khi chỉnh sửa giỏ; có thể thử hủy lại cùng đơn.';
  if (operation === 'payment') return 'Chưa xác nhận được kết quả thanh toán. Hãy thử lại cùng yêu cầu thanh toán; không tạo đơn mới.';
  return 'Chưa xác nhận được kết quả đặt đơn. Hãy thử lại cùng yêu cầu; không tạo đơn mới.';
}
