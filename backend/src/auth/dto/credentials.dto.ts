import { Transform } from "class-transformer";
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateBy,
} from "class-validator";

export class CredentialsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsNotEmpty({ message: "Email không được để trống" })
  @IsEmail({}, { message: "Email không đúng định dạng hợp lệ" })
  @MaxLength(254, { message: "Email vượt quá độ dài cho phép (254 ký tự)" })
  email!: string;

  @IsNotEmpty({ message: "Mật khẩu không được để trống" })
  @IsString({ message: "Mật khẩu phải là chuỗi ký tự" })
  @ValidateBy({
    name: "passwordBytes",
    validator: {
      validate: (value: unknown) =>
        typeof value === "string" &&
        Buffer.byteLength(value, "utf8") >= 8 &&
        Buffer.byteLength(value, "utf8") <= 72,
      defaultMessage: () => "Mật khẩu phải từ 8 đến 72 ký tự (UTF-8 bytes)",
    },
  })
  password!: string;
}
