/* eslint-disable prettier/prettier */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  //! CREER UN CLIENT ✅
  @Post()
  create(@Body() clientBody: CreateClientDto) {
    return this.clientsService.createClient({ clientBody });
  }

  //! CREER UN CLIENT VIA RDV  (via le bearer token, à tester en front) ✅
  @Post('from-appointment/:id')
  @UseGuards(JwtAuthGuard)
  async createFromAppointment(@Param("id") id: string, @Request() req: { user: { userId: string } }) {
    const userId: string = req.user.userId;
    return this.clientsService.createClientFromAppointment(id, userId);
  }

  //! VOIR TOUS LES CLIENTS 
  // @Get()
  // findAll() {
  //   return this.clientsService.getAllClients();
  // }
  
  //! VOIR TOUS LES CLIENTS D'UN SALON ✅
  @Get('salon/:id')
  getClientsBySalon(@Param('id') id: string) {
    return this.clientsService.getClientsBySalon(id);
  }

  //! VOIR UN SEUL CLIENT ✅
  @Get(':id')
  getOneClient(@Param('id') id: string) {
    return this.clientsService.getClientById(id);
  }

  //! MODIFIER UN CLIENT ✅
  @Patch('update/:id')
  updateClient(@Param('id') id: string, @Body() clientBody: CreateClientDto) {
    return this.clientsService.updateClient(id, clientBody); 
  }

  //! SUPPRIMER UN CLIENT ✅
  @Delete('delete/:id')
  deleteClient(@Param('id') id: string) {
    return this.clientsService.deleteClient(id);
  }
}
