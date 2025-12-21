import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { VerificationStatusDocument, SalonVerificationDocumentType } from '@prisma/client';

@Injectable()
export class SalonVerificationService {
  constructor(private prisma: PrismaService) {}

  //! -----------------------------------------------------------------
  
  //! DEPOSER UN DOCUMENT PAR UN SALON

  //! -----------------------------------------------------------------
  async submitDocument(userId: string, type: SalonVerificationDocumentType, fileUrl: string) {
    // Upsert to keep one doc per type per salon
    const document = await this.prisma.salonVerificationDocument.upsert({
      where: { userId_type: { userId, type } },
      update: {
        fileUrl,
        status: VerificationStatusDocument.PENDING,
        rejectionReason: null,
        uploadedAt: new Date(),
      },
      create: {
        userId,
        type,
        fileUrl,
        status: VerificationStatusDocument.PENDING,
      },
    });

    // Whenever a document changes, ensure verifiedSalon is recalculated
    await this.recalculateSalonVerification(userId);

    return {
      error: false,
      message: 'Document soumis pour vérification.',
      document,
    };
  }

  //! -----------------------------------------------------------------
  
  //! RÉCUPÉRER LES DOCUMENTS D'UN SALON

  //! -----------------------------------------------------------------
  async getMyDocuments(userId: string) {
    const docs = await this.prisma.salonVerificationDocument.findMany({
      where: { userId },
      orderBy: { uploadedAt: 'desc' },
    });

    // Also include overall verification flag
    const salon = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { verifiedSalon: true },
    });

    return {
      error: false,
      verifiedSalon: !!salon?.verifiedSalon,
      documents: docs,
    };
  }

  //! -----------------------------------------------------------------
  
  //! REVOIR UN DOCUMENT PAR UN ADMIN

  //! -----------------------------------------------------------------
  async reviewDocument(
    adminUserId: string,
    docId: string,
    status: VerificationStatusDocument,
    rejectionReason?: string,
  ) {
    // Optional: verify admin role; kept minimal here
    const admin = await this.prisma.user.findUnique({ where: { id: adminUserId }, select: { role: true } });
    if (!admin || admin.role !== 'admin') {
      return { error: true, message: "Vous n'êtes pas autorisé à valider ces documents." };
    }

    const updated = await this.prisma.salonVerificationDocument.update({
      where: { id: docId },
      data: {
        status,
        rejectionReason: status === VerificationStatusDocument.REJECTED ? (rejectionReason || 'Document refusé') : null,
        reviewedAt: new Date(),
        reviewedBy: adminUserId,
      },
    });

    // After review, recalc overall salon verification
    await this.recalculateSalonVerification(updated.userId);

    return { error: false, message: 'Statut du document mis à jour.', document: updated };
  }

  //! -----------------------------------------------------------------
  
  //! AIDE: RECALCULER LA VÉRIFICATION DU SALON

  //! -----------------------------------------------------------------
  // Helper: set verifiedSalon true if HYGIENE_SALUBRITE is approved
  private async recalculateSalonVerification(userId: string) {
    const docs = await this.prisma.salonVerificationDocument.findMany({
      where: { userId, status: VerificationStatusDocument.APPROVED },
      select: { type: true },
    });

    const approvedTypes = new Set(docs.map((d) => d.type));
    const required: SalonVerificationDocumentType[] = ['HYGIENE_SALUBRITE'];

    const allApproved = required.every((t) => approvedTypes.has(t));

    await this.prisma.user.update({
      where: { id: userId },
      data: { verifiedSalon: allApproved },
    });
  }
}
