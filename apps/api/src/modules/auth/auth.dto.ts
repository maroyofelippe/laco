import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Marco' }) @IsString() @Length(2, 120) name: string;
  @ApiProperty({ example: 'marco@exemplo.com' }) @IsEmail() @MaxLength(255) email: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) password: string;
  @ApiPropertyOptional({ enum: ['ANDROID', 'WEB'], default: 'ANDROID' }) @IsOptional() @IsIn(['ANDROID', 'WEB']) client?: 'ANDROID' | 'WEB';
}

export class LoginDto {
  @ApiProperty({ example: 'marco@exemplo.com' }) @IsEmail() email: string;
  @ApiProperty() @IsString() @MaxLength(128) password: string;
  @ApiPropertyOptional({ enum: ['ANDROID', 'WEB'], default: 'ANDROID' }) @IsOptional() @IsIn(['ANDROID', 'WEB']) client?: 'ANDROID' | 'WEB';
  @ApiPropertyOptional() @IsOptional() @IsUUID() deviceId?: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @Length(20, 200) refreshToken: string;
}
