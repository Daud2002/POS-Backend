import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../common';
import { parsePaging } from '../common/pagination';
import { AuditService } from './audit.service';

/**
 * The platform admin's view of everything that happened, store by store.
 * Nothing here is tenant-scoped: a store owner reads their own order history
 * from the order screens, not from this.
 */
@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Page through audit rows, newest first (platform admin only)' })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiQuery({ name: 'module', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO instant or YYYY-MM-DD (whole day, UTC)' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO instant or YYYY-MM-DD (whole day, UTC)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({ name: 'take', required: false, description: 'Max 100' })
  async list(
    @Query('storeId') storeId?: string,
    @Query('module') module?: string,
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const paging = parsePaging(skip, take, 50);
    return this.audit.query(
      { storeId, module, action, actorId, from, to, search },
      { skip: paging.skip, take: Math.min(paging.take, 100) },
    );
  }

  @Get('filters')
  @ApiOperation({ summary: 'Modules and actions available to filter by' })
  async filters() {
    return this.audit.filters();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One audit row, including its payload' })
  async findOne(@Param('id') id: string) {
    const row = await this.audit.findOne(id);
    if (!row) throw new NotFoundException('Audit row not found');
    return row;
  }
}
