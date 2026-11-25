import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, VerificationStatusDocument } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { UploadedFileCleanupService } from 'src/uploads/uploaded-file-cleanup.service';

/** Comptes qui gèrent des profils de tatoueurs internes (créés par le salon, sans compte Inkera). */
const SALON_ROLES = ['user_salon', 'user', 'admin'];

const documentSelect = {
  id: true,
  tatoueurId: true,
  fileUrl: true,
  status: true,
  rejectionReason: true,
  uploadedAt: true,
  reviewedAt: true,
} satisfies Prisma.TatoueurHygieneDocumentSelect;

export type HygieneReviewStatus = 'APPROVED' | 'REJECTED' | 'PENDING';

/**
 * Justificatif d'hygiène d'un tatoueur créé par un salon : le salon le dépose et le relie au profil du tatoueur,
 * l'administration l'accepte ou le refuse (même cycle que les justificatifs du salon : PENDING → APPROVED / REJECTED).
 */
@Injectable()
export class TatoueurHygieneService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly files?: UploadedFileCleanupService,
  ) {}

  private assertSalonRole(role: string | undefined) {
    if (!role || !SALON_ROLES.includes(role)) {
      throw new ForbiddenException('Seuls les salons gèrent les justificatifs de leurs tatoueurs.');
    }
  }

  private async ownedTatoueur(userId: string, role: string | undefined, tatoueurId: string) {
    this.assertSalonRole(role);
    const tatoueur = await this.prisma.tatoueur.findUnique({
      where: { id: tatoueurId },
      select: { id: true, userId: true, name: true },
    });
    if (!tatoueur || tatoueur.userId !== userId) throw new NotFoundException('Tatoueur introuvable.');
    return tatoueur;
  }

  /** Tatoueurs du salon avec l'état de leur justificatif d'hygiène. */
  async listForSalon(userId: string, role: string | undefined) {
    this.assertSalonRole(role);
    const tatoueurs = await this.prisma.tatoueur.findMany({
      where: { userId },
      select: { id: true, name: true, img: true, hygieneDocument: { select: documentSelect } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      error: false,
      tatoueurs: tatoueurs.map(({ hygieneDocument, ...t }) => ({ ...t, document: hygieneDocument ?? null })),
    };
  }

  async getForTatoueur(userId: string, role: string | undefined, tatoueurId: string) {
    await this.ownedTatoueur(userId, role, tatoueurId);
    const document = await this.prisma.tatoueurHygieneDocument.findUnique({
      where: { tatoueurId },
      select: documentSelect,
    });
    return { error: false, document };
  }

  /** Dépose (ou remplace) le justificatif : il repasse « en attente » de vérification. */
  async submit(userId: string, role: string | undefined, tatoueurId: string, fileUrl: string) {
    await this.ownedTatoueur(userId, role, tatoueurId);
    const url = (fileUrl ?? '').trim();
    if (!/^https:\/\/\S+$/i.test(url)) throw new BadRequestException('Adresse du fichier invalide.');

    const previous = await this.prisma.tatoueurHygieneDocument.findUnique({
      where: { tatoueurId },
      select: { fileUrl: true },
    });
    const document = await this.prisma.tatoueurHygieneDocument.upsert({
      where: { tatoueurId },
      create: { tatoueurId, salonId: userId, fileUrl: url },
      update: {
        salonId: userId,
        fileUrl: url,
        status: VerificationStatusDocument.PENDING,
        rejectionReason: null,
        reviewedAt: null,
        reviewedBy: null,
        uploadedAt: new Date(),
      },
      select: documentSelect,
    });
    if (previous && previous.fileUrl !== url) void this.files?.deleteIfUnused([previous.fileUrl]);
    return { error: false, message: 'Justificatif envoyé pour vérification.', document };
  }

  async remove(userId: string, role: string | undefined, tatoueurId: string) {
    await this.ownedTatoueur(userId, role, tatoueurId);
    const existing = await this.prisma.tatoueurHygieneDocument.findUnique({
      where: { tatoueurId },
      select: { id: true, fileUrl: true },
    });
    if (!existing) return { error: false, message: 'Aucun justificatif.' };
    await this.prisma.tatoueurHygieneDocument.delete({ where: { id: existing.id } });
    void this.files?.deleteIfUnused([existing.fileUrl]);
    return { error: false, message: 'Justificatif supprimé.' };
  }

  // ---------------------------------------------------------------- Administration

  async adminList(filters: { status?: string; search?: string; page?: number; limit?: number }) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(filters.limit) || 20));
    const status = (['PENDING', 'APPROVED', 'REJECTED'] as const).find((s) => s === filters.status);
    const search = filters.search?.trim();
    const where: Prisma.TatoueurHygieneDocumentWhereInput = {
      // Par défaut : les justificatifs à examiner. « ALL » : tous.
      ...(status ? { status } : filters.status === 'ALL' ? {} : { status: VerificationStatusDocument.PENDING }),
      ...(search
        ? {
            OR: [
              { tatoueur: { name: { contains: search, mode: 'insensitive' } } },
              { tatoueur: { user: { salonName: { contains: search, mode: 'insensitive' } } } },
              { tatoueur: { user: { email: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [documents, total, pending] = await Promise.all([
      this.prisma.tatoueurHygieneDocument.findMany({
        where,
        orderBy: { uploadedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          ...documentSelect,
          tatoueur: {
            select: {
              id: true,
              name: true,
              img: true,
              user: { select: { id: true, salonName: true, firstName: true, lastName: true, email: true, city: true, image: true } },
            },
          },
        },
      }),
      this.prisma.tatoueurHygieneDocument.count({ where }),
      this.prisma.tatoueurHygieneDocument.count({ where: { status: VerificationStatusDocument.PENDING } }),
    ]);
    return { error: false, documents, total, pending, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async adminReview(adminUserId: string, documentId: string, status: HygieneReviewStatus, rejectionReason?: string) {
    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) throw new BadRequestException('Statut invalide.');
    const reason = rejectionReason?.trim();
    if (status === 'REJECTED' && !reason) throw new BadRequestException('Précisez le motif du refus.');
    const existing = await this.prisma.tatoueurHygieneDocument.findUnique({
      where: { id: documentId },
      select: { id: true, tatoueur: { select: { id: true, name: true, userId: true } } },
    });
    if (!existing) throw new NotFoundException('Justificatif introuvable.');
    const document = await this.prisma.tatoueurHygieneDocument.update({
      where: { id: documentId },
      data: {
        status,
        rejectionReason: status === 'REJECTED' ? reason!.slice(0, 1000) : null,
        reviewedAt: status === 'PENDING' ? null : new Date(),
        reviewedBy: status === 'PENDING' ? null : adminUserId,
      },
      select: documentSelect,
    });
    if (status !== 'PENDING') {
      const approved = status === 'APPROVED';
      void this.notifications?.notify({
        userId: existing.tatoueur.userId,
        type: 'team.hygiene_reviewed',
        title: approved ? 'Justificatif d’hygiène validé' : 'Justificatif d’hygiène refusé',
        body: approved
          ? `Le justificatif d’hygiène de ${existing.tatoueur.name} a été validé.`
          : `Le justificatif d’hygiène de ${existing.tatoueur.name} a été refusé : ${reason}`,
        data: { tatoueurId: existing.tatoueur.id },
      });
    }
    return { error: false, message: 'Statut du justificatif mis à jour.', document };
  }
}
