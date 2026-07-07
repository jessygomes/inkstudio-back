import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  // Request,
  // UseGuards,
} from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientConsentDto } from './dto/update-client-consent.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { SaasLimitGuard } from 'src/saas/saas-limit.guard';
import { SaasLimit } from 'src/saas/saas-limit.decorator';
// import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  //! CREER UN CLIENT ✅
  @UseGuards(JwtAuthGuard, SaasLimitGuard)
  @SaasLimit('client')
  @Post()
  create(@Request() req: RequestWithUser, @Body() clientBody: CreateClientDto) {
    const userId = req.user.userId;
    return this.clientsService.createClient({ clientBody, userId });
  }

  //! CREER UN CLIENT VIA RDV  (via le bearer token, à tester en front) ✅
  // @Post('from-appointment/:id')
  // @UseGuards(JwtAuthGuard)
  // async createFromAppointment(@Param("id") id: string, @Request() req: { user: { userId: string } }) {
  //   const userId: string = req.user.userId;
  //   return this.clientsService.createClientFromAppointment(id, userId);
  // }

  //! VOIR TOUS LES CLIENTS 
  // @Get()
  // findAll() {
  //   return this.clientsService.getAllClients();
  // }
  
  //! VOIR TOUS LES CLIENTS D'UN SALON ✅
  @UseGuards(JwtAuthGuard)
  @Get('salon')
  async getClientsBySalon(@Request() req: RequestWithUser, @Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search: string = '') {
    const userId = req.user.userId;
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 5;
    return this.clientsService.getClientsBySalon(userId, pageNumber, limitNumber, search);
  }

  //! NOMBRE DE NVX CLIENTS PAR MOIS ✅
  @UseGuards(JwtAuthGuard, SaasLimitGuard)
  @SaasLimit('dashboard')
  @Get('new-clients-count/:id')
  async getNewClientsCountByMonth(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Query('month') month: number,
    @Query('year') year: number
  ) {
    if (req.user.userId !== id) {
      throw new ForbiddenException('Acces non autorise a ces statistiques.');
    }

    return this.clientsService.getNewClientsCountByMonth(id, month, year);
  }

  //! RECHERCHER UN CLIENT PAR NOM OU EMAIL (pour le formulaire de réservation) ✅
  @UseGuards(JwtAuthGuard)
  @Get('search')
  async getSearchClient(
    @Request() req: RequestWithUser,
    @Query('query') query: string,
  ) {
    const userId = req.user.userId;
    const clients = await this.clientsService.searchClients(query, userId);
    return clients; // même si []
  }

  //! VOIR UN SEUL CLIENT ✅
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getOneClient(@Request() req: RequestWithUser, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.clientsService.getClientById(id, userId);
  }

  //! MODIFIER UN CLIENT ✅
  @UseGuards(JwtAuthGuard)
  @Patch('update/:id')
  updateClient(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() clientBody: CreateClientDto,
  ) {
    const userId = req.user.userId;
    return this.clientsService.updateClient(id, userId, clientBody);
  }

  //! METTRE A JOUR LE CONSENTEMENT D'UN CLIENT ✅
  @UseGuards(JwtAuthGuard)
  @Patch(':id/consent')
  updateClientConsent(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() consentBody: UpdateClientConsentDto,
  ) {
    const userId = req.user.userId;
    return this.clientsService.updateClientConsent(id, userId, consentBody);
  }

  //! SUPPRIMER UN CLIENT ✅
  @UseGuards(JwtAuthGuard)
  @Delete('delete/:id')
  deleteClient(@Request() req: RequestWithUser, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.clientsService.deleteClient(id, userId);
  }
}
