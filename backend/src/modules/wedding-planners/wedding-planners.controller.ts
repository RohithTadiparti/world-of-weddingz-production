import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WeddingPlannersService } from './wedding-planners.service';
import { PlannerSearchDto, UpsertPlannerProfileDto } from './dto/wedding-planner.dto';
import { PayoutAccountDto } from '../vendors/dto/vendor.dto';
import { PayoutAccountsService } from '../vendors/payout-accounts.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('wedding-planners')
@Controller('wedding-planners')
export class WeddingPlannersController {
  constructor(
    private readonly planners: WeddingPlannersService,
    private readonly payoutAccounts: PayoutAccountsService,
  ) {}

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Browse approved wedding planners' })
  search(@Query() q: PlannerSearchDto) {
    return this.planners.search(q);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @Get('me')
  getOwn(@CurrentUser('userId') userId: string) {
    return this.planners.getOwn(userId);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @ApiOperation({ summary: 'Create or update your own planner listing' })
  @Put('me')
  upsertOwn(@CurrentUser('userId') userId: string, @Body() dto: UpsertPlannerProfileDto) {
    return this.planners.upsertOwn(userId, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @ApiOperation({
    summary: 'Where escrow pays out to',
    description:
      'The gateway linked account for this planner. Addressed as `me` rather than by id, like ' +
      'the rest of this controller: a planner has exactly one listing, so there is no id to get ' +
      'wrong and no other listing to aim at.',
  })
  @Put('me/payout-account')
  setPayoutAccount(@CurrentUser('userId') userId: string, @Body() dto: PayoutAccountDto) {
    return this.payoutAccounts.setForPlanner(userId, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @ApiOperation({
    summary: 'Where escrow pays out to, and how far its setup has got',
    description: 'The bank account number only ever comes back masked.',
  })
  @Get('me/payout-account')
  getPayoutAccount(@CurrentUser('userId') userId: string) {
    return this.payoutAccounts.getForPlanner(userId);
  }

  /**
   * The caller's saved planners. Held by whoever can hire one: saving is the
   * step before asking.
   */
  @ApiBearerAuth()
  @RequirePermissions(Permission.BOOKING_CREATE)
  @ApiOperation({ summary: 'Planners you have saved as favourites' })
  @Get('favourites')
  favourites(@CurrentUser('userId') userId: string) {
    return this.planners.listFavourites(userId);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.planners.findOne(id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.BOOKING_CREATE)
  @Get(':id/favourite')
  isFavourite(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.planners.isFavourite(userId, id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.BOOKING_CREATE)
  @ApiOperation({ summary: 'Save a planner as a favourite' })
  @Put(':id/favourite')
  addFavourite(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.planners.setFavourite(userId, id, true);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.BOOKING_CREATE)
  @ApiOperation({ summary: 'Remove a planner from your favourites' })
  @Delete(':id/favourite')
  removeFavourite(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.planners.setFavourite(userId, id, false);
  }
}
