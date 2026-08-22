import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RefreshTokenDto, RegisterDto, UserResponseDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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
    if (!user.isActive) {
      throw new BadRequestException('Your account is inactive.');
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
    const user = req.user as { id: string };
    return await this.authService.changePassword(
      user.id,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
  }
}
