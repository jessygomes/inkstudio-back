import { Controller, Get, Query, UseGuards, Request, Param, Delete, Post, Body, Patch } from '@nestjs/common';
import { CreateTattooCategoryDto, UpdateTattooCategoryDto } from './dto/tattoo-category.dto';
import { StyleNameDto } from './dto/style.dto';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { SaasPlan, Role } from '@prisma/client';
import { SendClientEmailDto } from './dto/send-client-email.dto';
import { SubscriptionInvitationsService } from './subscription-invitations.service';
import { CreateSubscriptionInvitationDto, UpdateInvitationDurationDto } from './dto/subscription-invitation.dto';

/*
  Guide d'ordre des routes (à respecter lors des ajouts)
  1) Routes statiques/collections SANS paramètres en premier
    - ex: GET 'salons', GET 'clients', GET 'stats'...
  2) Variantes de collection avec filtres (query params)
    - restent au même niveau que (1) car sans segments dynamiques
  3) Routes de création/mise à jour sur collections (POST/PATCH sur segments statiques)
    - ex: POST 'salons', PATCH 'salons/bulk' (si existantes)
  4) Routes DÉTAIL (AVEC paramètres :id) ensuite
    - ex: GET 'users/:id'
  5) Sous-ressources du détail (hiérarchie après :id)
    - ex: GET 'users/:id/documents', PATCH 'users/:id/status'
  6) Routes génériques/catch-all en DERNIER (si jamais utilisées)

  Rappels importants
  - Ne place jamais 'users/:id' AVANT une route statique/fréquemment utilisée comme 'users/search'.
  - Segments statiques > paramétrés: toujours définir les statiques en premier.
  - Grouper par ressource et par verbe quand c'est logique (lisibilité).
*/

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService, private readonly invitations: SubscriptionInvitationsService) {}

  @Get('invitations')
  listInvitations() { return this.invitations.list(); }

  @Post('invitations')
  createInvitation(@Body() body: CreateSubscriptionInvitationDto, @Request() req: RequestWithUser) {
    return this.invitations.create(body, req.user.userId);
  }

  @Patch('invitations/:id')
  updateInvitation(@Param('id') id: string, @Body() body: UpdateInvitationDurationDto) {
    return this.invitations.updateDuration(id, body.durationMonths);
  }

  @Delete('invitations/:id')
  revokeInvitation(@Param('id') id: string) { return this.invitations.revoke(id); }

  @Get('project-reports')
  projectReports(@Query('page') page?: string) {
    const parsed = Number(page || 1);
    return this.adminService.getProjectReports(Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 10000) : 1);
  }

  //! 1️⃣ ROUTES COLLECTION (statiques / filtres)
  //! RÉCUPÉRER LES STATISTIQUES
  @Get('stats')
  async getAdminStats() {
    return await this.adminService.getAdminStats();
  }

  //! RÉCUPÉRER LES DONNÉES D'ÉVOLUTION MENSUELLE
  @Get('evolution')
  async getMonthlyEvolution(
    @Query('months') months?: string
  ) {
    const monthsCount = months ? parseInt(months, 10) : 6;
    return await this.adminService.getMonthlyEvolution(monthsCount);
  }

  //! RÉCUPÉRER TOUS LES SALONS
  @Get('salons')
  async getAllSalons(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('saasPlan') saasPlan?: SaasPlan,
    @Query('verifiedSalon') verifiedSalon?: string,
    @Query('role') role?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    const verifiedSalonBool = verifiedSalon ? verifiedSalon === 'true' : undefined;
    const allowedRoles: string[] = [Role.user, Role.user_salon, Role.user_tatoueur];
    const parsedRole =
      role && allowedRoles.includes(role) ? (role as Role) : undefined;

    return await this.adminService.getAllSalons(pageNumber, limitNumber, search, saasPlan, verifiedSalonBool, parsedRole);
  }

  //! RÉCUPÉRER TOUS LES CLIENTS
  @Get('clients')
  async getAllClients(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;

    return await this.adminService.getAllClients(pageNumber, limitNumber, search);
  }

  //! ENVOYER UN EMAIL À UN CLIENT
  @Post('clients/:id/email')
  async sendEmailToClient(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: SendClientEmailDto,
  ): Promise<{ error: boolean; message: string }> {
    return await this.adminService.sendEmailToClient({
      clientId: id,
      adminUserId: req.user.userId,
      subject: body.subject,
      message: body.message,
    });
  }

  //! RÉCUPÉRER LES SALONS AVEC DES DOCUMENTS EN ATTENTE (PENDING)
  @Get('salons/pending-documents')
  async getSalonsWithPendingDocuments(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('saasPlan') saasPlan?: SaasPlan,
    @Query('verifiedSalon') verifiedSalon?: string
  ): Promise<any> {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    const verifiedSalonBool = verifiedSalon !== undefined ? verifiedSalon === 'true' : undefined;

    return await this.adminService.getSalonsWithPendingDocuments(pageNumber, limitNumber, search, saasPlan, verifiedSalonBool);
  }

  //! 2️⃣ ROUTES DÉTAIL (par id)
  //! LISTER LES STYLES AVEC LEUR NOMBRE D'UTILISATIONS
  @Get('styles')
  async getStyles() {
    return await this.adminService.getStyles();
  }

  //! CRÉER UN STYLE
  @Post('styles')
  async createStyle(@Body() body: StyleNameDto) {
    return await this.adminService.createStyle(body.name);
  }

  //! RENOMMER UN STYLE (mis à jour sur toutes les photos qui l'utilisent)
  @Patch('styles/:id')
  async updateStyle(@Param('id') id: string, @Body() body: StyleNameDto) {
    return await this.adminService.updateStyle(id, body.name);
  }

  //! SUPPRIMER UN STYLE (retiré de toutes les photos qui l'utilisent)
  @Delete('styles/:id')
  async deleteStyle(@Param('id') id: string) {
    return await this.adminService.deleteStyle(id);
  }
  //! LISTER TOUTES LES CATÉGORIES DE TATOUAGE (y compris inactives)
  @Get('tattoo-categories')
  async getTattooCategories() {
    return await this.adminService.getTattooCategories();
  }

  //! CRÉER UNE CATÉGORIE DE TATOUAGE
  @Post('tattoo-categories')
  async createTattooCategory(@Body() body: CreateTattooCategoryDto) {
    return await this.adminService.createTattooCategory(body);
  }

  //! MODIFIER UNE CATÉGORIE DE TATOUAGE
  @Patch('tattoo-categories/:id')
  async updateTattooCategory(@Param('id') id: string, @Body() body: UpdateTattooCategoryDto) {
    return await this.adminService.updateTattooCategory(id, body);
  }

  //! SUPPRIMER UNE CATÉGORIE DE TATOUAGE
  @Delete('tattoo-categories/:id')
  async deleteTattooCategory(@Param('id') id: string) {
    return await this.adminService.deleteTattooCategory(id);
  }

  //! RÉCUPÉRER UN UTILISATEUR PAR ID
  @Get('users/:id')
  async getUserById(
    @Param('id') id: string
  ) {
    return await this.adminService.getUserById(id);
  }

  //! SUPPRIMER UN UTILISATEUR ET SES DONNÉES ASSOCIÉES
  @Delete('users/:id')
  async deleteUser(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<{ error: boolean; message: string }> {
    return await this.adminService.deleteUserAndDependencies(id, req.user.userId);
  }
}
