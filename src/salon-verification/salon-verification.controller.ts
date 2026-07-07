import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ForbiddenException,
} from '@nestjs/common';
import { SalonVerificationService } from './salon-verification.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UseGuards, Request } from '@nestjs/common';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { VerificationStatusDocument, SalonVerificationDocumentType } from '@prisma/client';

@Controller('salon-verification')
export class SalonVerificationController {
  constructor(private readonly salonVerificationService: SalonVerificationService) {}

  //! DEPOSER UN DOCUMENT PAR UN SALON
  @UseGuards(JwtAuthGuard)
  @Post('documents')
  async submitDocument(
    @Request() req: RequestWithUser,
    @Body('type') type: SalonVerificationDocumentType,
    @Body('fileUrl') fileUrl: string,
  ) {
    const userId = req.user.userId;
    const role = req.user.role;

    const allowedRoles = ['user_salon', 'user_tatoueur'];

    if (!role || !allowedRoles.includes(role)) {
      throw new ForbiddenException(
        'Seuls les salons et tatoueurs peuvent soumettre des documents de vérification.',
      );
    }

    return await this.salonVerificationService.submitDocument(
      userId,
      role,
      type,
      fileUrl,
    );
  }

  //! RÉCUPÉRER LES DOCUMENTS D'UN SALON
  @UseGuards(JwtAuthGuard)
  @Get('documents')
  async getMyDocuments(@Request() req: RequestWithUser) {
    const userId = req.user.userId;
    return await this.salonVerificationService.getMyDocuments(userId);
  }

  //! REVOIR UN DOCUMENT PAR UN ADMIN
  @UseGuards(JwtAuthGuard)
  @Patch('documents/:id/status')
  async reviewDocument(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body('status') status: VerificationStatusDocument,
    @Body('rejectionReason') rejectionReason?: string,
  ) {
    const adminUserId = req.user.userId;
    return await this.salonVerificationService.reviewDocument(adminUserId, id, status, rejectionReason);
  }
}
