import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Family, Meta, MinRole, type AuthUser, type FamilyContext, type RequestMeta } from '../../common/context';
import { AcceptInvitationDto, CreateFamilyDto, CreateInvitationDto, SetPermissionsDto, UpdateFamilyDto, UpdateMemberDto } from './families.dto';
import { FamiliesService } from './families.service';

@ApiTags('Famílias')
@ApiBearerAuth()
@Controller()
export class FamiliesController {
  constructor(private readonly svc: FamiliesService) {}

  @Post('families')
  @ApiOperation({ summary: 'Cria família; o criador vira OWNER e recebe categorias padrão' })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateFamilyDto, @Meta() meta: RequestMeta) {
    return this.svc.create(u, dto.name, meta);
  }

  @Get('families/:familyId')
  get(@Family() ctx: FamilyContext) {
    return this.svc.get(ctx);
  }

  @Patch('families/:familyId')
  @MinRole('OWNER')
  update(@Family() ctx: FamilyContext, @Body() dto: UpdateFamilyDto, @Meta() meta: RequestMeta) {
    return this.svc.update(ctx, dto.name, meta);
  }

  @Get('families/:familyId/members')
  members(@Family() ctx: FamilyContext) {
    return this.svc.listMembers(ctx);
  }

  @Patch('families/:familyId/members/:userId')
  @MinRole('ADMIN')
  updateMember(@Family() ctx: FamilyContext, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: UpdateMemberDto, @Meta() meta: RequestMeta) {
    return this.svc.updateMember(ctx, userId, dto, meta);
  }

  @Delete('families/:familyId/members/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove membro (ADMIN) ou sai da família (o próprio usuário)' })
  removeMember(@Family() ctx: FamilyContext, @Param('userId', ParseUUIDPipe) userId: string, @Meta() meta: RequestMeta) {
    return this.svc.removeMember(ctx, userId, meta);
  }

  @Get('families/:familyId/members/:userId/permissions')
  @MinRole('ADMIN')
  getPermissions(@Family() ctx: FamilyContext, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.svc.getPermissions(ctx, userId);
  }

  @Put('families/:familyId/members/:userId/permissions')
  @MinRole('ADMIN')
  @ApiOperation({ summary: 'Substitui as permissões do membro em contas/cartões restritos' })
  setPermissions(@Family() ctx: FamilyContext, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: SetPermissionsDto, @Meta() meta: RequestMeta) {
    return this.svc.setPermissions(ctx, userId, dto, meta);
  }

  @Post('families/:familyId/invitations')
  @MinRole('ADMIN')
  invite(@Family() ctx: FamilyContext, @Body() dto: CreateInvitationDto, @Meta() meta: RequestMeta) {
    return this.svc.invite(ctx, dto, meta);
  }

  @Get('families/:familyId/invitations')
  @MinRole('ADMIN')
  invitations(@Family() ctx: FamilyContext) {
    return this.svc.listInvitations(ctx);
  }

  @Delete('families/:familyId/invitations/:id')
  @MinRole('ADMIN')
  @HttpCode(204)
  revoke(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.svc.revokeInvitation(ctx, id, meta);
  }

  @Post('invitations/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Aceita convite (o e-mail do usuário precisa ser o convidado)' })
  accept(@CurrentUser() u: AuthUser, @Body() dto: AcceptInvitationDto, @Meta() meta: RequestMeta) {
    return this.svc.accept(u, dto.token, meta);
  }
}
