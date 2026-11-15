import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class SupportRequestDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
export class SupportParamsDto { @IsUUID() id!: string; @IsUUID() requestId!: string; }
export class SupportReviewDto {
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @IsIn(['APPROVE','REJECT']) action!: 'APPROVE' | 'REJECT';
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) note!: string;
}
export class RefundUpdateDto {
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @IsIn(['APPROVE','SUCCEEDED','FAILED','RETRY']) action!: 'APPROVE'|'SUCCEEDED'|'FAILED'|'RETRY';
  @ValidateIf((_o,v:unknown)=>v!==undefined) @Transform(trim) @IsString() @MinLength(1) @MaxLength(128) transactionReference?: string;
  @ValidateIf((_o,v:unknown)=>v!==undefined) @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) evidenceReference?: string;
  @ValidateIf((_o,v:unknown)=>v!==undefined) @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) note?: string;
}
