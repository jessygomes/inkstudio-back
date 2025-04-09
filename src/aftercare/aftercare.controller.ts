import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { AftercareService } from './aftercare.service';
import { CreateAftercareDto } from './dto/create-aftercare.dto';
import { UpdateAftercareDto } from './dto/update-aftercare.dto';

@Controller('aftercare')
export class AftercareController {
  constructor(private readonly aftercareService: AftercareService) {}

  //! CREER UN SUIVI POST-TATOUAGE ✅
  @Post()
  async create(@Body() dto: CreateAftercareDto) {
    return this.aftercareService.createAftercare(dto);
  }

  //! MODIFIER UN SUIVI POST-TATOUAGE ✅
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAftercareDto) {
    return this.aftercareService.updateAftercare(id, dto);
  }

  //! SUPPRIMER UN SUIVI POST-TATOUAGE 
  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.aftercareService.deleteAftercare(id);
  }

}
