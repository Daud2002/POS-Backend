import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ImpersonationService } from './impersonation.service';
import {
  ChangePasswordDto,
  CreateImpersonationLinkDto,
  ExchangeImpersonationDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  UserResponseDto,
} from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles, RolesGuard, CurrentUser, clientIp, userAgentOf } from '../common';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private impersonationService: ImpersonationService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, description: 'Successfully logged in', schema: {
    example: {
      accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      user: {
        id: 'uuid',
        email: 'user@example.com',
        name: 'John Doe',
        role: 'employee',
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
    }
  }})
  @ApiResponse({ status: 400, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto, @Request() req: ExpressRequest) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );
    if (!user) {
      throw new BadRequestException('Invalid credentials');
    }
    const inactive = await this.authService.inactiveReason(user);
    if (inactive) {
      throw new BadRequestException(inactive);
    }
    return this.authService.login(user, req.headers['user-agent']);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Exchange a refresh token for a new access token' })
  @ApiResponse({
    status: 201,
    description: 'New token pair. The refresh token is rotated, so the caller must store the returned one.',
  })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or already-used refresh token' })
  async refresh(@Body() refreshDto: RefreshTokenDto, @Request() req: ExpressRequest) {
    return this.authService.refresh(refreshDto.refreshToken, req.headers['user-agent']);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke a refresh token and every token rotated from it' })
  @ApiResponse({ status: 201, schema: { example: { message: 'Logged out successfully' } } })
  async logout(@Body() refreshDto: RefreshTokenDto) {
    return this.authService.logout(refreshDto?.refreshToken);
  }

  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  @ApiResponse({ status: 200, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'Email already exists' })
  async register(@Body() registerDto: RegisterDto) {
    try {
      const user = await this.authService.register(
        registerDto.email,
        registerDto.password,
        registerDto.name,
      );
      return { message: 'User registered successfully', user };
    } catch (error) {
      throw new BadRequestException('Email already exists');
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile', type: UserResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(@Request() req: ExpressRequest) {
    return await this.authService.getUserWithStore(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the signed-in user\'s password' })
  @ApiResponse({
    status: 201,
    description: 'Password updated',
    schema: { example: { message: 'Password updated successfully' } },
  })
  @ApiResponse({ status: 400, description: 'Current password is incorrect' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async changePassword(
    @Request() req: ExpressRequest,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    const user = req.user as { id: string; impersonatedBy?: unknown };
    // An admin looking at a customer's account must not be able to lock the
    // customer out of it.
    if (user.impersonatedBy) {
      throw new ForbiddenException('Passwords cannot be changed from an impersonated session');
    }
    return await this.authService.changePassword(
      user.id,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
  }

  /**
   * "Open as owner / employee" for the platform admin.
   *
   * Returns a signed, single-use token good for an hour; the web app wraps it
   * in `/impersonate#token=…` and opens it in a new tab. Nothing is stored —
   * see ImpersonationService for the trade-offs.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Post('impersonation-links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a one-hour, single-use link that signs in as another user (platform admin only)' })
  @ApiResponse({ status: 201, schema: { example: { token: 'eyJ…', expiresAt: '2026-10-21T13:00:00.000Z', target: { id: 'uuid', name: 'Owner', role: 'restaurant_owner', storeName: 'Snack Fuel' } } } })
  @ApiResponse({ status: 400, description: 'The target account is inactive, or is you' })
  @ApiResponse({ status: 403, description: 'Admins cannot be impersonated' })
  @ApiResponse({ status: 503, description: 'IMPERSONATION_SECRET is not configured' })
  async createImpersonationLink(
    @CurrentUser() user: { id: string; name?: string },
    @Body() dto: CreateImpersonationLinkDto,
  ) {
    return this.impersonationService.issueLink({ id: user.id, name: user.name }, dto.targetUserId);
  }

  /**
   * Turns an impersonation link into a session: the same shape as /login,
   * except `refreshToken` is null (the session ends with the access token)
   * and `user.impersonatedBy` names the admin.
   */
  @Post('impersonation-links/exchange')
  @ApiOperation({ summary: 'Exchange an impersonation link for a one-hour session' })
  @ApiResponse({ status: 401, description: 'Invalid, expired or already-used link' })
  @ApiResponse({ status: 429, description: 'Too many attempts' })
  async exchangeImpersonationLink(
    @Body() dto: ExchangeImpersonationDto,
    @Request() req: ExpressRequest,
  ) {
    return this.impersonationService.exchange(dto.token, {
      ip: clientIp(req as any),
      userAgent: userAgentOf(req as any),
    });
  }
}
