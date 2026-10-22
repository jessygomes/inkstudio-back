import {
  BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode,
  Logger, Param, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequestWithUser } from '../../auth/jwt.strategy';
import { InstagramService } from './instagram.service';
import { assertInstagramWebhookSignature, requiredInstagramEnv } from './instagram-security';

@Controller('messaging/instagram')
export class InstagramController {
  private readonly logger = new Logger(InstagramController.name);
  constructor(private readonly instagram: InstagramService) {}

  @Get('connections')
  @UseGuards(JwtAuthGuard)
  connections(@Req() req: RequestWithUser) {
    return this.instagram.connections(req.user.userId);
  }

  @Get('connect')
  @UseGuards(JwtAuthGuard)
  connect(@Req() req: RequestWithUser) {
    return this.instagram.authorization(req.user.userId);
  }

  @Delete('connections/:id')
  @UseGuards(JwtAuthGuard)
  disconnect(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.instagram.disconnect(req.user.userId, id);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    if (error || !code || !state) return res.redirect(302, this.instagram.studioRedirect('cancelled'));
    try {
      await this.instagram.callback(code, state);
      return res.redirect(302, this.instagram.studioRedirect('connected'));
    } catch {
      this.logger.warn('Connexion Instagram impossible : vérifier le compte et les réglages OAuth');
      return res.redirect(302, this.instagram.studioRedirect('error'));
    }
  }

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') supplied: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() response: Response,
  ) {
    if (mode !== 'subscribe' || !supplied || supplied !== requiredInstagramEnv('INSTAGRAM_WEBHOOK_VERIFY_TOKEN') || !challenge) {
      throw new BadRequestException('Échec de la vérification du Webhook Instagram');
    }
    return response.status(200).type('text/plain').send(challenge);
  }

  @Post('webhook')
  @HttpCode(200)
  async receiveWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() payload: unknown,
  ) {
    assertInstagramWebhookSignature(request.rawBody, signature);
    await this.instagram.handleWebhook(payload as Parameters<InstagramService['handleWebhook']>[0]);
    return { received: true };
  }
}
