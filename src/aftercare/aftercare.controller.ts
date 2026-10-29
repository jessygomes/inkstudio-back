import {
  Body,
  Controller,
  Delete,
  Header,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequestWithUser } from '../auth/jwt.strategy';
import { AftercareService } from './aftercare.service';
import { CreateAftercareDto } from './dto/create-aftercare.dto';
import { UpdateAftercareDto } from './dto/update-aftercare.dto';

@Controller('aftercare')
@UseGuards(JwtAuthGuard)
export class AftercareController {
  constructor(private readonly aftercareService: AftercareService) {}

  //! CREER UN SUIVI POST-TATOUAGE ✅
  @Post()
  @Header('Cache-Control', 'private, no-store')
  async create(
    @Body() dto: CreateAftercareDto,
    @Request() req: RequestWithUser,
  ) {
    return this.aftercareService.createAftercare(dto, req.user.userId);
  }

  //! MODIFIER UN SUIVI POST-TATOUAGE ✅
  @Patch(':id')
  @Header('Cache-Control', 'private, no-store')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAftercareDto,
    @Request() req: RequestWithUser,
  ) {
    return this.aftercareService.updateAftercare(id, dto, req.user.userId);
  }

  //! SUPPRIMER UN SUIVI POST-TATOUAGE
  @Delete(':id')
  @Header('Cache-Control', 'private, no-store')
  async delete(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.aftercareService.deleteAftercare(id, req.user.userId);
  }
}
