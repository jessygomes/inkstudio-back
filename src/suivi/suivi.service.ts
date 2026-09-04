import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DrawingCardNoteType, DrawingCardStatus, PrestationType } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { CreateDrawingCardDto } from './dto/create-drawing-card.dto';
import { CreateDrawingCardNoteDto } from './dto/create-drawing-card-note.dto';
import { CreateDrawingCardImageDto } from './dto/create-drawing-card-image.dto';
import { UpdateDrawingCardImageDto } from './dto/update-drawing-card-image.dto';
import { SearchDrawingCardsDto } from './dto/search-drawing-cards.dto';
import { UpdateDrawingCardDto } from './dto/update-drawing-card.dto';

@Injectable()
export class SuiviService {
  constructor(private readonly prisma: PrismaService) {}

  // Les relations sont regroupées ici afin que toutes les réponses de l'API
  // contiennent les informations nécessaires à l'affichage d'une card.
  private readonly cardInclude = {
    sourceAppointment: { select: { id: true, title: true, start: true, end: true, prestation: true, status: true } },
    tattooAppointment: { select: { id: true, title: true, start: true, end: true, status: true } },
    client: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
    clientUser: { select: { id: true, firstName: true, lastName: true, email: true } },
    tatoueur: { select: { id: true, name: true } },
    performerUser: { select: { id: true, firstName: true, lastName: true, salonName: true } },
    notes: { orderBy: { createdAt: 'asc' as const }, include: { author: { select: { id: true, firstName: true, lastName: true } } } },
    images: { orderBy: { createdAt: 'asc' as const } },
  };

  // Vérifie qu'une card est visible par le salon propriétaire ou par le tatoueur assigné.
  private async getCardForUser(cardId: string, userId: string) {
    const card = await this.prisma.drawingCard.findUnique({
      where: { id: cardId },
      include: this.cardInclude,
    });

    if (!card) throw new NotFoundException('Card de dessin introuvable.');

    if (card.salonId !== userId && card.performerUserId !== userId) {
      throw new ForbiddenException('Accès refusé à cette card.');
    }

    return card;
  }

  // Crée une card à partir d'un RDV autorisé et recopie les images du moodboard client.
  async createCard(userId: string, dto: CreateDrawingCardDto) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: dto.sourceAppointmentId },
      include: { moodboard: { include: { images: true } }, tattooDetail: true },
    });

    if (!appointment) throw new NotFoundException('Rendez-vous source introuvable.');
    if (appointment.userId !== userId && appointment.performerUserId !== userId) {
      throw new ForbiddenException('Vous ne pouvez pas créer une card depuis ce rendez-vous.');
    }
    if (appointment.prestation !== PrestationType.PROJET && appointment.userId !== userId) {
      throw new BadRequestException('Une card peut être créée depuis un RDV Projet ou un RDV créé par le tatoueur.');
    }

    const existingCard = await this.prisma.drawingCard.findUnique({ where: { sourceAppointmentId: appointment.id } });
    if (existingCard) throw new BadRequestException('Une card existe déjà pour ce rendez-vous.');

    return this.prisma.drawingCard.create({
      data: {
        salonId: appointment.userId,
        sourceAppointmentId: appointment.id,
        clientId: appointment.clientId,
        clientUserId: appointment.clientUserId,
        tatoueurId: appointment.tatoueurId,
        performerUserId: appointment.performerUserId,
        title: dto.title?.trim() || appointment.title,
        description: dto.description ?? appointment.tattooDetail?.description,
        additionalInfo: dto.additionalInfo,
        images: appointment.moodboard?.images.length
          ? { create: appointment.moodboard.images.map((image) => ({ url: image.url, caption: image.caption, uploadedById: userId })) }
          : undefined,
      },
      include: this.cardInclude,
    });
  }

  // Retourne les cards du Kanban, avec un filtre optionnel par statut.
  async getCards(userId: string, query: SearchDrawingCardsDto = {}) {
    // Le scope salon/tatoueur est toujours appliqué avant les filtres de recherche.
    const search = query.search?.trim();
    const where: Record<string, unknown> = {
      OR: [{ salonId: userId }, { performerUserId: userId }],
    };
    if (query.status) where.status = query.status;
    if (query.tatoueurId) {
      where.OR = [
        { salonId: userId, tatoueurId: query.tatoueurId },
        { salonId: userId, performerUserId: query.tatoueurId },
      ];
    }
    if (search) {
      where.AND = [{
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { client: { firstName: { contains: search, mode: 'insensitive' } } },
          { client: { lastName: { contains: search, mode: 'insensitive' } } },
          { clientUser: { firstName: { contains: search, mode: 'insensitive' } } },
          { clientUser: { lastName: { contains: search, mode: 'insensitive' } } },
        ],
      }];
    }
    if (query.appointmentDateFrom || query.appointmentDateTo) {
      where.sourceAppointment = {
        start: {
          ...(query.appointmentDateFrom ? { gte: new Date(query.appointmentDateFrom) } : {}),
          ...(query.appointmentDateTo ? { lte: new Date(query.appointmentDateTo) } : {}),
        },
      };
    }

    return this.prisma.drawingCard.findMany({
      where,
      include: this.cardInclude,
      orderBy: { updatedAt: 'desc' },
    });
  }

  // Indique à l'interface si le RDV peut proposer une card et si elle existe déjà.
  async getAppointmentCardStatus(appointmentId: string, userId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, userId: true, performerUserId: true, prestation: true, status: true },
    });

    if (!appointment) throw new NotFoundException('Rendez-vous introuvable.');
    if (appointment.userId !== userId && appointment.performerUserId !== userId) {
      throw new ForbiddenException('Accès refusé à ce rendez-vous.');
    }

    const card = await this.prisma.drawingCard.findUnique({
      where: { sourceAppointmentId: appointmentId },
      select: { id: true, status: true },
    });
    const canCreate = appointment.prestation === PrestationType.PROJET || appointment.performerUserId === userId;

    return {
      appointmentId,
      appointmentCompleted: appointment.status === 'COMPLETED',
      canCreate,
      cardExists: !!card,
      cardId: card?.id ?? null,
      cardStatus: card?.status ?? null,
    };
  }

  // Met à jour les informations éditables et enregistre les dates de workflow.
  async updateCard(cardId: string, userId: string, dto: UpdateDrawingCardDto) {
    await this.getCardForUser(cardId, userId);
    const data: Record<string, unknown> = { ...dto };
    if (dto.status === DrawingCardStatus.APPROUVE) data.approvedAt = new Date();
    if (dto.status === DrawingCardStatus.TERMINE) data.completedAt = new Date();

    return this.prisma.drawingCard.update({ where: { id: cardId }, data, include: this.cardInclude });
  }

  // Supprime une card : les relations enfants sont supprimées par cascade Prisma.
  async deleteCard(cardId: string, userId: string) {
    await this.getCardForUser(cardId, userId);
    await this.prisma.drawingCard.delete({ where: { id: cardId } });
    return { message: 'Card Dessin supprimée avec succès.' };
  }

  // Ajoute une trace datée à la timeline de la card.
  async addNote(cardId: string, userId: string, dto: CreateDrawingCardNoteDto) {
    await this.getCardForUser(cardId, userId);
    return this.prisma.drawingCardNote.create({
      data: { cardId, authorId: userId, content: dto.content, type: dto.type ?? DrawingCardNoteType.INTERNAL },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  // Ajoute une nouvelle version sans supprimer les anciennes images de la card.
  async addImage(cardId: string, userId: string, dto: CreateDrawingCardImageDto) {
    await this.getCardForUser(cardId, userId);
    const lastImage = await this.prisma.drawingCardImage.findFirst({
      where: { cardId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    return this.prisma.drawingCardImage.create({
      data: {
        cardId,
        uploadedById: userId,
        url: dto.url,
        caption: dto.caption,
        version: (lastImage?.version ?? 0) + 1,
      },
    });
  }

  // Marque une seule version comme dessin approuvé et remet les autres versions à false.
  async approveImage(cardId: string, imageId: string, userId: string) {
    await this.getCardForUser(cardId, userId);
    const image = await this.prisma.drawingCardImage.findFirst({ where: { id: imageId, cardId } });
    if (!image) throw new NotFoundException('Image introuvable dans cette card.');

    await this.prisma.drawingCardImage.updateMany({ where: { cardId }, data: { isApproved: false } });
    return this.prisma.drawingCardImage.update({ where: { id: imageId }, data: { isApproved: true } });
  }

  // Modifie la légende sans modifier l'URL ni le numéro de version.
  async updateImageCaption(cardId: string, imageId: string, userId: string, dto: UpdateDrawingCardImageDto) {
    await this.getCardForUser(cardId, userId);
    const image = await this.prisma.drawingCardImage.findFirst({ where: { id: imageId, cardId } });
    if (!image) throw new NotFoundException('Image introuvable dans cette card.');
    return this.prisma.drawingCardImage.update({ where: { id: imageId }, data: { caption: dto.caption } });
  }

  // Supprime uniquement l'image demandée après avoir vérifié la card parente.
  async deleteImage(cardId: string, imageId: string, userId: string) {
    await this.getCardForUser(cardId, userId);
    const image = await this.prisma.drawingCardImage.findFirst({ where: { id: imageId, cardId } });
    if (!image) throw new NotFoundException('Image introuvable dans cette card.');
    await this.prisma.drawingCardImage.delete({ where: { id: imageId } });
    return { message: 'Image supprimée avec succès.' };
  }

  // Relie uniquement une card approuvée à un RDV Tattoo du même salon et du même client.
  async linkTattooAppointment(cardId: string, appointmentId: string, userId: string) {
    const card = await this.getCardForUser(cardId, userId);
    if (card.status !== DrawingCardStatus.APPROUVE) throw new BadRequestException('Seule une card approuvée peut être reliée à un RDV Tattoo.');

    const appointment = await this.prisma.appointment.findFirst({ where: { id: appointmentId, userId, prestation: PrestationType.TATTOO } });
    if (!appointment) throw new BadRequestException('Le RDV Tattoo est introuvable ou ne dépend pas de ce salon.');
    if (card.clientId && appointment.clientId !== card.clientId) throw new BadRequestException('Le RDV Tattoo ne concerne pas le même client.');
    if (card.clientUserId && appointment.clientUserId !== card.clientUserId) throw new BadRequestException('Le RDV Tattoo ne concerne pas le même client connecté.');

    return this.prisma.drawingCard.update({ where: { id: cardId }, data: { tattooAppointmentId: appointmentId }, include: this.cardInclude });
  }
}
