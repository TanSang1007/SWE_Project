import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { OrderParamsDto } from './order.dto';
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class SupportRequestDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
export class SupportParamsDto extends OrderParamsDto { @IsUUID() requestId!: string; }
export class SupportReviewDto {
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @IsIn(['APPROVE','REJECT']) action!: 'APPROVE' | 'REJECT';
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) note!: string;
}
// Version sai -> 409 CONCURRENT_UPDATE; thiếu phê duyệt/bằng chứng/lý do hợp lệ
// -> 422 REFUND_EVIDENCE_REQUIRED; không có tiền đã thu -> REFUND_NOT_AVAILABLE.
export class RefundUpdateDto {
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @IsIn(['APPROVE','SUCCEEDED','FAILED','RETRY']) action!: 'APPROVE'|'SUCCEEDED'|'FAILED'|'RETRY';
  @ValidateIf((_o,v:unknown)=>v!==undefined) @Transform(trim) @IsString() @MinLength(1) @MaxLength(128) transactionReference?: string;
  @ValidateIf((_o,v:unknown)=>v!==undefined) @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) evidenceReference?: string;
  @ValidateIf((_o,v:unknown)=>v!==undefined) @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) note?: string;
}
