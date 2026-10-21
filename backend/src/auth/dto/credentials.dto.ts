import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, ValidateBy } from 'class-validator';

export class CredentialsDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @ValidateBy({ name: 'passwordBytes', validator: {
    validate: (value: unknown) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 8 && Buffer.byteLength(value, 'utf8') <= 72,
    defaultMessage: () => 'password must contain 8 to 72 UTF-8 bytes',
  } })
  password!: string;
}
