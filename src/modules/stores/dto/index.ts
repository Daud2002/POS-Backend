import { IsString, IsOptional, IsIn, IsEmail, IsBoolean, IsInt, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Recording a subscription payment. Exactly one of `months` / `expiresAt`:
 * a preset extends what is left, an exact date overrides it (the service
 * enforces the either/or). Every field must be declared here or the global
 * `whitelist: true` ValidationPipe drops it silently.
 */
export class ExtendSubscriptionDto {
  @ApiProperty({ required: false, enum: [1, 2, 3, 6, 12], description: 'Months paid for, added to the remaining time' })
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3, 6, 12])
  months?: number;

  @ApiProperty({ required: false, example: '2027-01-21', description: 'Exact day the store is paid through (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expiresAt must be YYYY-MM-DD' })
  expiresAt?: string;

  @ApiProperty({ required: false, description: 'Free text, e.g. how it was paid' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @ApiProperty({ required: false, example: 'Asia/Karachi', description: "The admin's IANA zone; 'today' is taken in it" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;
}

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

/**
 * What a store OWNER may change about their own store.
 *
 * Deliberately much narrower than UpdateStoreDto, which stays platform-admin
 * only: `plan`, `currency` and `type` are commercial/structural settings, and
 * an owner editing their own plan is not a thing this product allows.
 *
 * Every field must be declared here or the global `whitelist: true`
 * ValidationPipe drops it silently.
 */
export class UpdateStoreSettingsDto {
  @ApiProperty({ required: false, description: 'Shown on receipts and in the app.' })
  @IsOptional()
  @IsString()
  name?: string;

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

  @ApiProperty({
    required: false,
    description:
      'Require cashiers to open a shift before taking payments. Restaurant accounts only.',
  })
  @IsOptional()
  @IsBoolean()
  shiftsEnabled?: boolean;
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
