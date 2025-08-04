import { Controller, Get, Post, Body, UseGuards, Param, Patch } from '@nestjs/common';
import { SaasService } from './saas.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('saas')
// @UseGuards(JwtAuthGuard)
export class SaasController {
  constructor(private readonly saasService: SaasService) {}

  /**
   *! 📊 RÉCUPÉRER LES STATISTIQUES D'UTILISATION DU SALON
   * GET /saas/usage
   */
  @Get('usage')
  async getUsageStats(@Param('userId') userId: string) {
    return await this.saasService.getUsageStats(userId);
  }

  /**
   * 📝 RÉCUPÉRER LES DÉTAILS DU PLAN
   * GET /saas/plan/:userID
   */
  @Get('plan/:userId')
  async getPlanDetails(@Param('userId') userId: string) {
    return await this.saasService.getUserPlanDetails(userId);
  }

  /**
   *! ✅ VÉRIFIER LES LIMITES ACTUELLES
   * GET /saas/limits
   */
  @Get('limits')
  async checkLimits(@Param('userId') userId: string) {
    return await this.saasService.checkLimits(userId);
  }

  /**
   *! 🔧 VÉRIFIER SI UNE FONCTIONNALITÉ EST DISPONIBLE
   * POST /saas/check-feature
   * Body: { feature: 'advancedStats' | 'emailReminders' | 'customBranding' | 'apiAccess' }
   */
  @Post('check-feature')
  async checkFeature(
    @Param('userId') userId: string,
    @Body() body: { feature: 'advancedStats' | 'emailReminders' | 'customBranding' | 'apiAccess' }
  ) {
    const hasFeature = await this.saasService.hasFeature(userId, body.feature);
    return { feature: body.feature, available: hasFeature };
  }

  /**
   *! 🆙 PASSER AU PLAN (FREE, MEDIUM, PREMIUM)
   * POST /saas/upgrade/:userId
   * Body: { plan: 'FREE' | 'MEDIUM' | 'PREMIUM', endDate?: string }
   */
  @Patch('upgrade/:userId')
  async upgradePlan(
    @Param('userId') userId: string,
    @Body() body: { plan: 'FREE' | 'PRO' | 'BUSINESS', endDate?: string }
  ) {
    const endDate = body.endDate ? new Date(body.endDate) : undefined;
    
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const updatedPlan = await this.saasService.updateUserPlan(userId, body.plan as any, endDate);
    return {
      success: true,
      message: `Plan mis à jour vers ${body.plan}`,
      plan: updatedPlan
    };
  }

  /**
   *! 🆙 PASSER AU PLAN MEDIUM (HELPER)
   * POST /saas/upgrade-pro
   */
  @Post('upgrade-pro')
  async upgradeToPro(
    @Param('userId') userId: string,
    @Body() body: { endDate?: string }
  ) {
    const endDate = body.endDate ? new Date(body.endDate) : undefined;
    
    const updatedPlan = await this.saasService.upgradeToMedium(userId, endDate);
    return {
      success: true,
      message: 'Plan mis à jour vers MEDIUM',
      plan: updatedPlan
    };
  }

  /**
   *! 🚀 PASSER AU PLAN PREMIUM (HELPER)
   * POST /saas/upgrade-business
   */
  @Post('upgrade-business')
  async upgradeToBusiness(
    @Param('userId') userId: string,
    @Body() body: { endDate?: string }
  ) {
    const endDate = body.endDate ? new Date(body.endDate) : undefined;
    
    const updatedPlan = await this.saasService.upgradeToPremium(userId, endDate);
    return {
      success: true,
      message: 'Plan mis à jour vers PREMIUM',
      plan: updatedPlan
    };
  }

  /**
   *! 🔧 CORRIGER UN PLAN EXISTANT (DEBUG)
   * POST /saas/fix-plan/:userId
   */
  @Post('fix-plan/:userId')
  async fixPlan(@Param('userId') userId: string) {
    const fixedPlan = await this.saasService.fixExistingPlan(userId);
    return {
      success: true,
      message: 'Plan corrigé avec succès',
      plan: fixedPlan
    };
  }
}
