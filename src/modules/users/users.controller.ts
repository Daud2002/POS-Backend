import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, UserRole } from './dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { Roles, RolesGuard, parsePaging, wantsCount } from '@/common';

/**
 * Platform-admin only, in full.
 *
 * `create` accepts an arbitrary `role`, so leaving this open let anyone mint
 * themselves an admin account. Both client callers (StoreOwnersPage and the
 * owner activate/deactivate toggle on StoresPage) are super-admin screens, so
 * locking the whole controller costs nothing.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(
    @Query('role') role?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
  ) {
    if (wantsCount(withCount)) {
      const paging = parsePaging(skip, take);
      return this.usersService.findAllPaged(role as UserRole, paging.skip, paging.take);
    }
    return this.usersService.findAll(role as UserRole);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Patch(':id')
  partialUpdate(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
