import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { config } from '../../config';
import { Meta, Public, type RequestMeta } from '../../common/context';
import { LoginDto, RefreshDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('Auth')
@Public()
// 10 tentativas/min por IP (relaxado só na suíte de testes)
@Throttle({ default: { limit: config.isTest ? 10_000 : 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Cria conta e já devolve a sessão' })
  register(@Body() dto: RegisterDto, @Meta() meta: RequestMeta) {
    return this.auth.register(dto, meta);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login com e-mail e senha' })
  login(@Body() dto: LoginDto, @Meta() meta: RequestMeta) {
    return this.auth.login(dto, meta);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Troca refresh token por novo par (rotação)' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Encerra a sessão (revoga a cadeia do refresh token)' })
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }
}
