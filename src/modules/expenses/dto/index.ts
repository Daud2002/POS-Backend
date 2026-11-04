import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsUUID,
  IsIn,
  Min,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EXPENSE_PAYMENT_METHODS } from '@/entities';

/**
 * A calendar day in the store's own timezone, sent by the client.
 *
 * Validated as a literal 'YYYY-MM-DD' rather than @IsDateString(), which also
 * accepts full ISO timestamps — those would be re-interpreted as UTC and could
 * book an evening expense on the wrong day.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateExpenseCategoryDto {
  @ApiProperty({ example: 'Utilities' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ required: false, example: 'Electricity, gas and water' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateExpenseCategoryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateExpenseSubcategoryDto {
  @ApiProperty({ description: 'The expense category it sits under' })
  @IsUUID()
  categoryId: string;

  @ApiProperty({ example: 'Ahmad' })
  @IsString()
  @MaxLength(255)
  name: string;
}

export class UpdateExpenseSubcategoryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateExpenseDto {
  @ApiProperty({ example: 'October electricity bill' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 12500.5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ required: false, description: 'Expense category id' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ required: false, description: "One of the category's subcategories" })
  @IsOptional()
  @IsUUID()
  subcategoryId?: string;

  @ApiProperty({
    required: false,
    example: 'Ahmad',
    description: 'A subcategory by name, created under the category if it does not exist yet. Wins over subcategoryId.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subcategoryName?: string;

  @ApiProperty({ example: '2026-08-24', description: 'Calendar day, YYYY-MM-DD. Defaults to today.' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'expenseDate must be in YYYY-MM-DD format' })
  expenseDate?: string;

  @ApiProperty({ required: false, enum: EXPENSE_PAYMENT_METHODS })
  @IsOptional()
  @IsIn(EXPENSE_PAYMENT_METHODS)
  paymentMethod?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateExpenseDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiProperty({ required: false, description: 'null clears it. Changing the category clears it too.' })
  @IsOptional()
  @IsUUID()
  subcategoryId?: string | null;

  @ApiProperty({ required: false, description: 'As on create: found or created under the category.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subcategoryName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'expenseDate must be in YYYY-MM-DD format' })
  expenseDate?: string;

  @ApiProperty({ required: false, enum: EXPENSE_PAYMENT_METHODS })
  @IsOptional()
  @IsIn(EXPENSE_PAYMENT_METHODS)
  paymentMethod?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

