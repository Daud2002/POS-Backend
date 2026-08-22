import { IsString, IsOptional, IsIn, IsEmail, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateStoreDto {
  @ApiProperty({ example: 'My Store' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'store@example.com', description: 'Store owner email for login' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', description: 'Store owner password' })
  @IsString()
  @MinLength(6)
  password: string;

  /**
   * Selects the tenant's whole feature set. 'general' is the original
   * behaviour and the default, so omitting it keeps existing callers working.
   * Cannot be changed later — switching would strand tables and orders.
   */
  @ApiProperty({ example: 'general', enum: ['general', 'restaurant'], required: false })
  @IsOptional()
  @IsIn(['general', 'restaurant'])
  accountType?: 'general' | 'restaurant';

  /** @deprecated Cosmetic label superseded by `accountType`. No longer set by the UI. */
  @ApiProperty({ example: 'Restaurant', required: false, deprecated: true })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ example: 'starter', required: false })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiProperty({ example: 'PKR', required: false })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: '123 Main St', required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ example: '+92 123 456 7890', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ example: 'BP-80', required: false, description: 'QZ Tray printer name used for receipts' })
  @IsOptional()
  @IsString()
  printerConfig?: string;
}

export class UpdateStoreDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ required: false, description: 'QZ Tray printer name used for receipts' })
  @IsOptional()
  @IsString()
  printerConfig?: string;
}
