import { IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
export class LoyaltyHistoryQueryDto {
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @Matches(/^(?:[1-9]|[1-4]\d|50)$/)
    limit?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @MinLength(1)
    @MaxLength(512)
    @Matches(/^[A-Za-z0-9_-]+$/)
    cursor?: string;
}
