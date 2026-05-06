import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateMoodboardDto } from './dto/create-moodboard.dto';
import { UpdateMoodboardDto } from './dto/update-moodboard.dto';
import { AddMoodboardImageDto } from './dto/add-moodboard-image.dto';

@Injectable()
export class MoodboardService {
  constructor(private readonly prisma: PrismaService) {}

  //! ─── UTILS ────────────────────────────────────────────────────────────────

  private async getClientProfileOrThrow(userId: string) {
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Profil client introuvable.');
    }
    return profile;
  }

  private async getMoodboardOrThrow(id: string) {
    const moodboard = await this.prisma.moodboard.findUnique({
      where: { id },
    });
    if (!moodboard) {
      throw new NotFoundException('Moodboard introuvable.');
    }
    return moodboard;
  }

  private async assertOwnership(moodboardId: string, userId: string) {
    const profile = await this.getClientProfileOrThrow(userId);
    const moodboard = await this.getMoodboardOrThrow(moodboardId);
    if (moodboard.clientProfileId !== profile.id) {
      throw new ForbiddenException('Accès refusé à ce moodboard.');
    }
    return { moodboard, profile };
  }

  //! ─── MOODBOARD CRUD ───────────────────────────────────────────────────────

  //! CRÉER UN MOODBOARD
  async createMoodboard(userId: string, dto: CreateMoodboardDto) {
    const profile = await this.getClientProfileOrThrow(userId);

    return this.prisma.moodboard.create({
      data: {
        clientProfileId: profile.id,
        name: dto.name,
        description: dto.description,
      },
      include: { images: true },
    });
  }

  //! VOIR TOUS SES MOODBOARDS
  async getMyMoodboards(userId: string) {
    const profile = await this.getClientProfileOrThrow(userId);

    return this.prisma.moodboard.findMany({
      where: { clientProfileId: profile.id },
      include: {
        images: { orderBy: { position: 'asc' } },
        appointments: {
          select: { id: true, title: true, start: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  //! VOIR UN MOODBOARD (client propriétaire ou salon qui a le rdv lié)
  async getMoodboardById(id: string, userId: string) {
    const moodboard = await this.prisma.moodboard.findUnique({
      where: { id },
      include: {
        images: { orderBy: { position: 'asc' } },
        appointments: {
          select: { id: true, title: true, start: true, status: true, userId: true },
        },
        clientProfile: { select: { userId: true } },
      },
    });

    if (!moodboard) {
      throw new NotFoundException('Moodboard introuvable.');
    }

    const isOwner = moodboard.clientProfile.userId === userId;
    const isSalonWithAccess = moodboard.appointments.some(
      (apt) => apt.userId === userId,
    );

    if (!isOwner && !isSalonWithAccess) {
      throw new ForbiddenException('Accès refusé à ce moodboard.');
    }

    return moodboard;
  }

  //! MODIFIER UN MOODBOARD (nom, description)
  async updateMoodboard(id: string, userId: string, dto: UpdateMoodboardDto) {
    await this.assertOwnership(id, userId);

    return this.prisma.moodboard.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
      include: { images: { orderBy: { position: 'asc' } } },
    });
  }

  //! SUPPRIMER UN MOODBOARD
  async deleteMoodboard(id: string, userId: string) {
    await this.assertOwnership(id, userId);

    await this.prisma.moodboard.delete({ where: { id } });

    return { message: 'Moodboard supprimé avec succès.' };
  }

  //! ─── IMAGES ───────────────────────────────────────────────────────────────

  //! AJOUTER UNE IMAGE AU MOODBOARD
  async addImage(moodboardId: string, userId: string, dto: AddMoodboardImageDto) {
    await this.assertOwnership(moodboardId, userId);

    return this.prisma.moodboardImage.create({
      data: {
        moodboardId,
        url: dto.url,
        caption: dto.caption,
        position: dto.position ?? 0,
      },
    });
  }

  //! SUPPRIMER UNE IMAGE DU MOODBOARD
  async removeImage(moodboardId: string, imageId: string, userId: string) {
    await this.assertOwnership(moodboardId, userId);

    const image = await this.prisma.moodboardImage.findUnique({
      where: { id: imageId },
    });

    if (!image || image.moodboardId !== moodboardId) {
      throw new NotFoundException('Image introuvable dans ce moodboard.');
    }

    await this.prisma.moodboardImage.delete({ where: { id: imageId } });

    return { message: 'Image supprimée avec succès.' };
  }

  //! ─── CONNEXION AU RDV ─────────────────────────────────────────────────────

  //! CONNECTER UN MOODBOARD À UN RDV
  async connectToAppointment(
    moodboardId: string,
    appointmentId: string,
    userId: string,
  ) {
    await this.assertOwnership(moodboardId, userId);

    // Vérifier que le rdv appartient bien au client connecté
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      throw new NotFoundException('Rendez-vous introuvable.');
    }

    if (appointment.clientUserId !== userId) {
      throw new ForbiddenException(
        'Vous ne pouvez connecter un moodboard qu\'à vos propres rendez-vous.',
      );
    }

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { moodboardId },
      select: { id: true, title: true, start: true, moodboardId: true },
    });
  }

  //! DÉCONNECTER UN MOODBOARD D'UN RDV
  async disconnectFromAppointment(
    moodboardId: string,
    appointmentId: string,
    userId: string,
  ) {
    await this.assertOwnership(moodboardId, userId);

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      throw new NotFoundException('Rendez-vous introuvable.');
    }

    if (appointment.clientUserId !== userId) {
      throw new ForbiddenException(
        'Vous ne pouvez déconnecter un moodboard que de vos propres rendez-vous.',
      );
    }

    if (appointment.moodboardId !== moodboardId) {
      throw new ForbiddenException(
        'Ce moodboard n\'est pas connecté à ce rendez-vous.',
      );
    }

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { moodboardId: null },
      select: { id: true, title: true, start: true, moodboardId: true },
    });
  }

  //! ─── ACCÈS SALON ──────────────────────────────────────────────────────────

  //! VOIR LE MOODBOARD CONNECTÉ À UN RDV (accès salon)
  async getMoodboardByAppointment(appointmentId: string, salonUserId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, userId: true, moodboardId: true },
    });

    if (!appointment) {
      throw new NotFoundException('Rendez-vous introuvable.');
    }

    if (appointment.userId !== salonUserId) {
      throw new ForbiddenException('Accès refusé à ce rendez-vous.');
    }

    if (!appointment.moodboardId) {
      return { moodboard: null };
    }

    const moodboard = await this.prisma.moodboard.findUnique({
      where: { id: appointment.moodboardId },
      include: { images: { orderBy: { position: 'asc' } } },
    });

    return { moodboard };
  }
}
