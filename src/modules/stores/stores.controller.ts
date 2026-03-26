import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { StoresService } from './stores.service';
import { CreateStoreDto, UpdateStoreDto } from './dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';

@ApiTags('Stores')
@Controller('stores')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard)
export class StoresController {
  constructor(private storesService: StoresService) {}

  @Get()
  @ApiOperation({ summary: 'Get all stores' })
  @ApiResponse({ status: 200, description: 'List of stores' })
  async getAllStores(
    @Query('skip') skip: number = 0,
    @Query('take') take: number = 10,
  ) {
    return this.storesService.findAll(skip, take);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get store by ID' })
  @ApiResponse({ status: 200, description: 'Store details' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async getStore(@Param('id') id: string) {
    return this.storesService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new store' })
  @ApiResponse({ status: 201, description: 'Store created successfully' })
  async createStore(@Body() createStoreDto: CreateStoreDto) {
    return this.storesService.create(createStoreDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update store' })
  @ApiResponse({ status: 200, description: 'Store updated successfully' })
  async updateStore(
    @Param('id') id: string,
    @Body() updateStoreDto: UpdateStoreDto,
  ) {
    return this.storesService.update(id, updateStoreDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete store' })
  @ApiResponse({ status: 200, description: 'Store deleted successfully' })
  async deleteStore(@Param('id') id: string) {
    return this.storesService.delete(id);
  }
}
