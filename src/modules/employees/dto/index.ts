import { IsString, IsEmail, IsOptional, MinLength, IsDecimal, IsBoolean, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'EMP001', description: 'Unique employee ID' })
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'john@example.com', description: 'Employee email for login' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', description: 'Employee password' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: '+92 123 456 7890', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ example: '123 Main St', required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ example: 25000, required: false })
  @IsOptional()
  salary?: number;

  @ApiProperty({ example: '2024-01-15', required: false })
  @IsOptional()
  @IsDateString()
  joinDate?: string;

  /**
   * Free text for general stores, where live data already holds arbitrary
   * values like "Manager" or "Sales Rep". Restaurant stores are restricted to
   * waiter | kitchen | cashier, enforced in the service where the store's
   * account type is known.
   */
  @ApiProperty({
    example: 'cashier',
    enum: ['cashier', 'manager', 'staff', 'waiter', 'kitchen'],
    required: false,
  })
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiProperty({ required: false, description: 'Default printer for this station (optional).' })
  @IsOptional()
  @IsString()
  printerName?: string;

  @ApiProperty({ example: true, required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateEmployeeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  salary?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  joinDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  printerName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
