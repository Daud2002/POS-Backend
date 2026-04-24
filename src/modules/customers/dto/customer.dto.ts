import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCustomerDto {
  @ApiProperty({ example: 'John Doe', description: 'Customer name' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: '555-1234', description: 'Phone number' })
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiProperty({ example: '123 Main St', description: 'Address' })
  @IsNotEmpty()
  @IsString()
  address: string;

  @ApiProperty({ example: 'john@example.com', required: false, description: 'Email (optional)' })
  @IsOptional()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'New York', required: false })
  @IsOptional()
  @IsString()
  city: string;
}

export class UpdateCustomerDto {
  @ApiProperty({ example: 'John Doe', required: false })
  @IsOptional()
  @IsString()
  name: string;

  @ApiProperty({ example: '555-1234', required: false })
  @IsOptional()
  @IsString()
  phone: string;

  @ApiProperty({ example: '123 Main St', required: false })
  @IsOptional()
  @IsString()
  address: string;

  @ApiProperty({ example: 'john@example.com', required: false })
  @IsOptional()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'New York', required: false })
  @IsOptional()
  @IsString()
  city: string;
}
