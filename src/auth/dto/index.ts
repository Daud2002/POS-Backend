import { IsEmail, IsNotEmpty, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateImpersonationLinkDto {
  @ApiProperty({ description: 'The store owner or employee (users.id) to sign in as' })
  @IsUUID()
  targetUserId: string;
}

export class ExchangeImpersonationDto {
  @ApiProperty({ description: 'The token from an impersonation link' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  token: string;
}

export class LoginDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', description: 'User password' })
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', description: 'User password' })
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'John Doe', description: 'User full name' })
  @IsNotEmpty()
  name: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'The opaque refresh token issued at login or by the previous refresh' })
  @IsNotEmpty()
  @IsString()
  refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'oldpassword123', description: 'The user\'s current password' })
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ example: 'newpassword123', description: 'The new password, min 6 characters' })
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  phone?: string;

  @ApiProperty()
  role: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiProperty({ description: 'Currency code from store', example: 'PKR' })
  currency?: string;

  @ApiProperty({ description: 'QZ Tray printer name from store', example: 'BP-80' })
  printerConfig?: string;
}
