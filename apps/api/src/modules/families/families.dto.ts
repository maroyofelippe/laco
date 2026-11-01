import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, ValidateNested } from 'class-validator';
import type { Role } from '../../db/types';

export class CreateFamilyDto {
  @ApiProperty({ example: 'Família Royo' }) @IsString() @Length(2, 120) name: string;
}

export class UpdateFamilyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string;
}

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] })
  @IsOptional() @IsIn(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']) role?: Role;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED']) status?: 'ACTIVE' | 'SUSPENDED';

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 60) displayName?: string;
}

export class PermissionItemDto {
  @ApiProperty({ enum: ['ACCOUNT', 'CARD'] }) @IsIn(['ACCOUNT', 'CARD']) resourceType: 'ACCOUNT' | 'CARD';
  @ApiProperty() @IsUUID() resourceId: string;
  @ApiProperty({ enum: ['VIEW', 'EDIT'] }) @IsIn(['VIEW', 'EDIT']) access: 'VIEW' | 'EDIT';
}

export class SetPermissionsDto {
  @ApiProperty({ type: [PermissionItemDto] })
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PermissionItemDto)
  items: PermissionItemDto[];
}

export class CreateInvitationDto {
  @ApiProperty({ example: 'ana@exemplo.com' }) @IsEmail() email: string;
  @ApiProperty({ enum: ['ADMIN', 'MEMBER', 'VIEWER'] }) @IsIn(['ADMIN', 'MEMBER', 'VIEWER']) role: 'ADMIN' | 'MEMBER' | 'VIEWER';
}

export class AcceptInvitationDto {
  @ApiProperty() @IsString() @Length(20, 200) token: string;
}
