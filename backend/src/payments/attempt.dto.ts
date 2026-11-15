import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const trimLower = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value;

export class InitiateAttemptDto {
    @Transform(trimLower)
    @IsString()
    @Matches(idPattern)
    orderId!: string;
}
export class AttemptParamsDto {
    @Transform(trimLower)
    @IsString()
    @Matches(idPattern)
    attemptId!: string;
}
export class AttemptOrderParamsDto {
    @Transform(trimLower)
    @IsString()
    @Matches(idPattern)
    id!: string;
}
export class AttemptEmptyDto {
}
export class AttemptListDto {
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @Matches(/^(?:[1-9]|1\d|20)$/)
    limit?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @MinLength(1)
    @MaxLength(768)
    @Matches(/^[A-Za-z0-9_-]+$/)
    cursor?: string;
}
