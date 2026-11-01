import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/context';
import { Errors } from '../../common/errors';
import { newId } from '../../common/util';
import { InjectDb, type Db } from '../../db/database';

class UpdateMeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string;
}

class RegisterDeviceDto {
  @ApiProperty({ description: 'Token FCM do aparelho' }) @IsString() @MaxLength(512) fcmToken: string;
  @ApiPropertyOptional({ enum: ['ANDROID', 'WEB'] }) @IsOptional() @IsIn(['ANDROID', 'WEB']) platform?: 'ANDROID' | 'WEB';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) appVersion?: string;
}

@ApiTags('Usuário')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Get()
  async me(@CurrentUser() u: AuthUser) {
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'name', 'email', 'created_at as createdAt'])
      .where('id', '=', u.id)
      .executeTakeFirst();
    if (!user) throw Errors.unauthorized();
    return user;
  }

  @Patch()
  async update(@CurrentUser() u: AuthUser, @Body() dto: UpdateMeDto) {
    if (dto.name) await this.db.updateTable('users').set({ name: dto.name.trim() }).where('id', '=', u.id).execute();
    return this.me(u);
  }

  @Get('families')
  families(@CurrentUser() u: AuthUser) {
    return this.db
      .selectFrom('family_members as m')
      .innerJoin('families as f', 'f.id', 'm.family_id')
      .select(['f.id', 'f.name', 'f.currency', 'm.role', 'm.joined_at as joinedAt'])
      .where('m.user_id', '=', u.id)
      .where('m.status', '=', 'ACTIVE')
      .where('f.deleted_at', 'is', null)
      .orderBy('f.name')
      .execute();
  }

  @Post('devices')
  async registerDevice(@CurrentUser() u: AuthUser, @Body() dto: RegisterDeviceDto) {
    // Token FCM é único: se já pertencia a outro usuário (troca de conta no aparelho), é transferido
    await this.db.deleteFrom('devices').where('fcm_token', '=', dto.fcmToken).execute();
    const id = newId();
    await this.db
      .insertInto('devices')
      .values({ id, user_id: u.id, platform: dto.platform ?? 'ANDROID', fcm_token: dto.fcmToken, app_version: dto.appVersion ?? '0' })
      .execute();
    return { id };
  }

  @Delete('devices/:id')
  @HttpCode(204)
  async removeDevice(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.deleteFrom('devices').where('id', '=', id).where('user_id', '=', u.id).execute();
  }
}
