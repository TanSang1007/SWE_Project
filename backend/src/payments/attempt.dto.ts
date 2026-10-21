import { Transform } from 'class-transformer';
import { IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
export class InitiateAttemptDto {
    @Transform(({ value }: {
        value: unknown;
    }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
    @IsUUID()
    orderId!: string;
}
export class AttemptParamsDto {
    @IsUUID()
    attemptId!: string;
}
export class AttemptOrderParamsDto {
    @IsUUID()
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
