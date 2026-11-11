import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SecurityThrottle } from '../auth/security-throttle';
import { BookingIdentityGuard } from './booking-identity.guard';
import { BookingLinksService } from './booking-links.service';
import {
  BookingLinkAvailabilityDto,
  ConfirmBookingLinkDto,
  CreateBookingLinkDto,
  ListBookingLinksDto,
} from './dto/booking-link.dto';

@ApiTags('Appointment booking links')
@Controller('appointments/booking-links')
export class BookingLinksController {
  constructor(private readonly links: BookingLinksService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  create(
    @Request() req: { user: { userId: string } },
    @Body() body: CreateBookingLinkDto,
  ) {
    return this.links.create(req.user.userId, body);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  list(
    @Request() req: { user: { userId: string } },
    @Query() query: ListBookingLinksDto,
  ) {
    return this.links.list(req.user.userId, query);
  }

  @Get('public/:token')
  @SecurityThrottle('bookingLinkRead')
  publicInfo(@Param('token') token: string) {
    return this.links.publicInfo(token);
  }

  @Get('public/:token/availability')
  @SecurityThrottle('bookingLinkRead')
  availability(
    @Param('token') token: string,
    @Query() query: BookingLinkAvailabilityDto,
  ) {
    return this.links.availability(token, query);
  }

  @Post('public/:token/confirm')
  @SecurityThrottle('booking')
  @UseGuards(BookingIdentityGuard)
  confirm(
    @Param('token') token: string,
    @Body() body: ConfirmBookingLinkDto,
    @Request() req: { user?: { userId: string } },
  ) {
    return this.links.confirm(token, body, req.user?.userId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  get(@Request() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.links.get(req.user.userId, id);
  }

  @Patch('revoke/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  revoke(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.links.revoke(req.user.userId, id);
  }
}
