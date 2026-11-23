import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequestWithUser } from '../auth/jwt.strategy';
import { SecurityThrottle } from '../auth/security-throttle';
import { AcceptAwardDto, EnterGiveawayDto, PublicationConsentDto } from './dto/giveaway.dto';
import { GiveawaysService } from './giveaways.service';

/**
 * Routes publiques et participant. L'identité du participant vient TOUJOURS du
 * jeton (`req.user.userId`), jamais du corps de la requête.
 */
@ApiTags('Giveaways')
@Controller('giveaways')
export class GiveawaysController {
  constructor(private readonly giveaways: GiveawaysService) {}

  @Get()
  @SecurityThrottle('giveawayRead')
  @ApiOperation({ summary: 'Concours publiés' })
  list() {
    return this.giveaways.list();
  }

  @Get(':slug')
  @SecurityThrottle('giveawayRead')
  detail(@Param('slug') slug: string) {
    return this.giveaways.detail(slug);
  }

  @Get(':slug/rules')
  @SecurityThrottle('giveawayRead')
  rules(@Param('slug') slug: string) {
    return this.giveaways.rules(slug);
  }

  @Get(':slug/results')
  @SecurityThrottle('giveawayRead')
  @ApiOperation({ summary: 'Résultats publiés (noms affichés seulement avec le consentement du gagnant)' })
  results(@Param('slug') slug: string) {
    return this.giveaways.results(slug);
  }

  @Get(':slug/eligibility')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  eligibility(@Param('slug') slug: string, @Request() req: RequestWithUser) {
    return this.giveaways.eligibilityFor(slug, req.user.userId);
  }

  @Get(':slug/my-entry')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  myEntry(@Param('slug') slug: string, @Request() req: RequestWithUser) {
    return this.giveaways.myEntry(slug, req.user.userId);
  }

  @Post(':slug/entries')
  @UseGuards(JwtAuthGuard)
  @SecurityThrottle('giveawayEntry')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Participer (idempotent)' })
  enter(@Param('slug') slug: string, @Request() req: RequestWithUser, @Body() body: EnterGiveawayDto) {
    return this.giveaways.enter(slug, req.user.userId, body);
  }

  @Delete(':slug/my-entry')
  @UseGuards(JwtAuthGuard)
  @SecurityThrottle('giveawayEntry')
  @ApiBearerAuth('access-token')
  withdraw(@Param('slug') slug: string, @Request() req: RequestWithUser) {
    return this.giveaways.withdraw(slug, req.user.userId);
  }

  @Post(':slug/my-award/accept')
  @UseGuards(JwtAuthGuard)
  @SecurityThrottle('giveawayEntry')
  @ApiBearerAuth('access-token')
  acceptAward(@Param('slug') slug: string, @Request() req: RequestWithUser, @Body() body: AcceptAwardDto) {
    return this.giveaways.acceptAward(slug, req.user.userId, body.publicationConsent);
  }

  @Post(':slug/my-award/decline')
  @UseGuards(JwtAuthGuard)
  @SecurityThrottle('giveawayEntry')
  @ApiBearerAuth('access-token')
  declineAward(@Param('slug') slug: string, @Request() req: RequestWithUser) {
    return this.giveaways.declineAward(slug, req.user.userId);
  }

  @Patch(':slug/my-award/publication-consent')
  @UseGuards(JwtAuthGuard)
  @SecurityThrottle('giveawayEntry')
  @ApiBearerAuth('access-token')
  publicationConsent(@Param('slug') slug: string, @Request() req: RequestWithUser, @Body() body: PublicationConsentDto) {
    return this.giveaways.setPublicationConsent(slug, req.user.userId, body.publicationConsent);
  }
}
