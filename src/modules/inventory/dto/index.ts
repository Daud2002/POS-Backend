import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsUUID,
  IsIn,
  IsInt,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { INVENTORY_UNITS } from '@/entities';

export class CreateInventoryItemDto {
  @ApiProperty({ example: 'Milk' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ enum: INVENTORY_UNITS, example: 'ml' })
  @IsIn(INVENTORY_UNITS)
  unit: string;

  @ApiProperty({ required: false, example: 6, description: 'Bottles per set. Bottle items only.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  packSize?: number;

  @ApiProperty({ required: false, example: 2000, description: 'Opening stock, in the item unit' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity?: number;

  @ApiProperty({ required: false, example: 1000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  lowStockThreshold?: number | null;
}

/**
 * The count is deliberately NOT editable here — it only moves through
 * stock-in, adjust and sales, so every change leaves a movement behind.
 * Nor is the unit: recipes are written in it, and changing ml to g would
 * silently reinterpret every one of them.
 */
export class UpdateInventoryItemDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  packSize?: number;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  lowStockThreshold?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class StockInDto {
  @ApiProperty({ example: 4, description: 'How much arrived — in sets when inPacks is true' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  amount: number;

  @ApiProperty({
    required: false,
    description: 'Bottle items only: amount is a number of sets, multiplied by packSize',
  })
  @IsOptional()
  @IsBoolean()
  inPacks?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdjustStockDto {
  @ApiProperty({ example: 1850, description: 'The counted quantity on hand, in the item unit' })
  @IsNumber({ maxDecimalPlaces: 3 })
  quantity: number;

  @ApiProperty({ required: false, example: 'Spilled a carton' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RecipeLineDto {
  @ApiProperty()
  @IsUUID()
  inventoryItemId: string;

  @ApiProperty({ example: 200, description: 'Used per ONE unit of the product, in the item unit' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;
}

export class SetRecipeDto {
  @ApiProperty({ type: [RecipeLineDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  ingredients: RecipeLineDto[];
}
