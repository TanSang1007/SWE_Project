import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';

const codes: Record<number, string> = {
  400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
  409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 422: 'UNPROCESSABLE_ENTITY', 503: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const parserStatus = getBodyParserStatus(exception);
    const status = exception instanceof HttpException ? exception.getStatus() : parserStatus ?? HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = codes[status] ?? 'INTERNAL_SERVER_ERROR';
    let details: string[] | { existingOrderId: string } = [];
    if (exception instanceof HttpException && status < 500) {
      const body = exception.getResponse();
      if (typeof body === 'object' && 'code' in body && typeof body.code === 'string') code = body.code;
      if (typeof body === 'object' && code === 'INVALID_ORDER_STATE' && 'details' in body
        && typeof body.details === 'object' && body.details !== null && 'existingOrderId' in body.details
        && typeof body.details.existingOrderId === 'string' && /^[0-9a-f-]{36}$/i.test(body.details.existingOrderId)) {
        details = { existingOrderId: body.details.existingOrderId };
      }
      if (typeof body === 'string') message = body;
      else if ('message' in body) {
        const value: unknown = body.message;
        if (typeof value === 'string') message = value;
        else if (Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')) {
          message = 'Request validation failed'; details = value;
        }
      }
    } else if (parserStatus === 413) message = 'Request payload too large';
    else if (parserStatus === 400) message = 'Invalid JSON request body';
    else if (status >= 500) {
      // Preserve the explicit payment protocol code without exposing technical messages.
      if (exception instanceof HttpException && status === 503) {
        const body = exception.getResponse();
        if (typeof body === 'object' && 'code' in body && body.code === 'PAYMENT_UNAVAILABLE') {
          code = 'PAYMENT_UNAVAILABLE'; message = 'Payment result was not committed; retry the same request';
        }
        if (typeof body === 'object' && 'code' in body && body.code === 'PAYMENT_ADMISSION_CLOSED') {
          code = 'PAYMENT_ADMISSION_CLOSED';
          message = 'VNPAY đang tạm ngừng nhận thanh toán mới. Vui lòng giữ nguyên giỏ hàng và kiểm tra lại sau.';
        }
      }
      this.logger.error('Unhandled server error');
    }
    response.status(status).json({
      error: { code, message, details, requestId: randomUUID() },
    });
  }
}

export function getBodyParserStatus(exception: unknown): 400 | 413 | undefined {
  if (typeof exception !== 'object' || exception === null || !('type' in exception) || !('status' in exception)) {
    return undefined;
  }
  if (exception.type === 'entity.too.large' && exception.status === 413) return 413;
  if (exception.type === 'entity.parse.failed' && exception.status === 400) return 400;
  return undefined;
}
