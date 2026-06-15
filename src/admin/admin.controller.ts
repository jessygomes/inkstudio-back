import { Controller, Get, Query, UseGuards, Request, Param, Delete, Post, Body } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { SaasPlan, Role } from '@prisma/client';
import { SendClientEmailDto } from './dto/send-client-email.dto';

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
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  //! 1️⃣ ROUTES COLLECTION (statiques / filtres)
  //! RÉCUPÉRER LES STATISTIQUES
  @UseGuards(JwtAuthGuard)
  @Get('stats')
  async getAdminStats(@Request() req: RequestWithUser) {
    if (req.user.role !== 'admin') {
      return {
        error: true,
        message: 'Accès réservé aux administrateurs.',
      };
    }
    return await this.adminService.getAdminStats();
  }

  //! RÉCUPÉRER LES DONNÉES D'ÉVOLUTION MENSUELLE
  @UseGuards(JwtAuthGuard)
  @Get('evolution')
  async getMonthlyEvolution(
    @Request() req: RequestWithUser,
    @Query('months') months?: string
  ) {
    if (req.user.role !== 'admin') {
      return {
        error: true,
        message: 'Accès réservé aux administrateurs.',
      };
    }
    const monthsCount = months ? parseInt(months, 10) : 6;
    return await this.adminService.getMonthlyEvolution(monthsCount);
  }

  //! RÉCUPÉRER TOUS LES SALONS
  @UseGuards(JwtAuthGuard)
  @Get('salons')
  async getAllSalons(
    @Request() req: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('saasPlan') saasPlan?: SaasPlan,
    @Query('verifiedSalon') verifiedSalon?: string,
    @Query('role') role?: string,
  ) {
    if (req.user.role !== 'admin') {
      return {
        error: true,
        message: 'Accès réservé aux administrateurs.',
      };
    }

    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    const verifiedSalonBool = verifiedSalon ? verifiedSalon === 'true' : undefined;
    const allowedRoles: string[] = [Role.user, Role.user_salon, Role.user_tatoueur];
    const parsedRole =
      role && allowedRoles.includes(role) ? (role as Role) : undefined;

    return await this.adminService.getAllSalons(pageNumber, limitNumber, search, saasPlan, verifiedSalonBool, parsedRole);
  }

  //! RÉCUPÉRER TOUS LES CLIENTS
  @UseGuards(JwtAuthGuard)
  @Get('clients')
  async getAllClients(
    @Request() req: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string
  ) {
    // Vérifier que l'utilisateur est admin
    if (req.user.role !== 'admin') {
      return {
        error: true,
        message: 'Accès réservé aux administrateurs.',
      };
    }

    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;

    return await this.adminService.getAllClients(pageNumber, limitNumber, search);
  }

  //! ENVOYER UN EMAIL À UN CLIENT
  @UseGuards(JwtAuthGuard)
  @Post('clients/:id/email')
  async sendEmailToClient(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: SendClientEmailDto,
  ): Promise<{ error: boolean; message: string }> {
    if (req.user.role !== 'admin') {
      return {
        error: true,
        message: 'Accès réservé aux administrateurs.',
      };
    }

    return await this.adminService.sendEmailToClient({
      clientId: id,
      adminUserId: req.user.userId,
      subject: body.subject,
      message: body.message,
    });
  }

  //! RÉCUPÉRER LES SALONS AVEC DES DOCUMENTS EN ATTENTE (PENDING)
  @UseGuards(JwtAuthGuard)
  @Get('salons/pending-documents')
  async getSalonsWithPendingDocuments(
    @Request() req: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('saasPlan') saasPlan?: SaasPlan,
    @Query('verifiedSalon') verifiedSalon?: string
  ): Promise<any> {
    if (req.user.role !== 'admin') {
      return {
        error: true,
        message: 'Accès réservé aux administrateurs.',
      };
    }

    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    const verifiedSalonBool = verifiedSalon !== undefined ? verifiedSalon === 'true' : undefined;

    return await this.adminService.getSalonsWithPendingDocuments(pageNumber, limitNumber, search, saasPlan, verifiedSalonBool);
  }

  //! 2️⃣ ROUTES DÉTAIL (par id)
  //! RÉCUPÉRER UN UTILISATEUR PAR ID
  @UseGuards(JwtAuthGuard)
  @Get('users/:id')
  async getUserById(
    @Request() req: RequestWithUser,
    @Param('id') id: string
  ) {
    if (req.user.role !== 'admin') {
      return {
        error: true,
        message: 'Accès réservé aux administrateurs.',
      };
    }
    return await this.adminService.getUserById(id);
  }

  //! SUPPRIMER UN UTILISATEUR ET SES DONNÉES ASSOCIÉES
  @UseGuards(JwtAuthGuard)
  @Delete('users/:id')
  async deleteUser(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<{ error: boolean; message: string }> {
    if (req.user.role !== 'admin') {
      return {
        error: true,
        message: 'Accès réservé aux administrateurs.',
      };
    }

    return await this.adminService.deleteUserAndDependencies(id, req.user.userId);
  }
}
