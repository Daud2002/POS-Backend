import { IsString, IsOptional, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateStoreDto {
  @ApiProperty({ example: 'My Store' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Restaurant', required: false })
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

  @ApiProperty({ example: 'store@example.com', required: false })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ example: 'active', required: false })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string;
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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string;
}
