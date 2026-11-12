import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginThrottleService } from './login-throttle.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppError } from '../common/errors/app-error';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthUser, RequestWithAuth } from './auth.types';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly throttle: LoginThrottleService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
    @Req() req: RequestWithAuth,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) {
      throw AppError.validation('Idempotency-Key header (UUID) is required', [
        { field: 'Idempotency-Key', code: 'invalid', message: 'must be a UUID' },
      ]);
    }
    const session = await this.auth.register(dto, req.traceId ?? 'unknown');
    return this.envelope(req, session);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: RequestWithAuth) {
    const email = dto.email.trim().toLowerCase();
    this.throttle.assertAllowed(email);
    try {
      const session = await this.auth.login(dto);
      this.throttle.recordSuccess(email);
      return this.envelope(req, session);
    } catch (err) {
      if (err instanceof AppError && err.code === 'UNAUTHENTICATED') {
        this.throttle.recordFailure(email);
      }
      throw err;
    }
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() req: RequestWithAuth) {
    const session = await this.auth.refresh(dto);
    return this.envelope(req, session);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthUser, @Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(user.id, dto);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logoutAll(user.id);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser, @Req() req: RequestWithAuth) {
    const data = await this.auth.me(user.id);
    return this.envelope(req, data);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(user.id, dto);
  }

  private envelope(req: RequestWithAuth, data: unknown) {
    return { data, meta: { traceId: req.traceId ?? 'unknown' } };
  }
}
