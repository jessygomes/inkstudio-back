import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DrawingCardNoteType, DrawingCardStatus, PrestationType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { CreateDrawingCardDto } from './dto/create-drawing-card.dto';
import { CreateDrawingCardNoteDto } from './dto/create-drawing-card-note.dto';
import { CreateDrawingCardImageDto } from './dto/create-drawing-card-image.dto';
import { UpdateDrawingCardImageDto } from './dto/update-drawing-card-image.dto';
import { SearchDrawingCardsDto } from './dto/search-drawing-cards.dto';
import { UpdateDrawingCardDto } from './dto/update-drawing-card.dto';
import { UpdateDrawingAssociationsDto } from './dto/update-drawing-associations.dto';

@Injectable()
export class SuiviService {
  constructor(private readonly prisma: PrismaService) {}

  // Les relations sont regroupées ici afin que toutes les réponses de l'API
  // contiennent les informations nécessaires à l'affichage d'une card.
  private readonly cardInclude = {
    sourceAppointment: { select: { id: true, title: true, start: true, end: true, prestation: true, status: true } },
    tattooAppointment: { select: { id: true, title: true, start: true, end: true, status: true } },
    client: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, linkedUserId: true } },
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

  private async requireProfessional(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || !['user', 'user_salon', 'user_tatoueur', 'admin'].includes(user.role)) {
      throw new ForbiddenException('La création de suivis est réservée aux professionnels.');
    }
    return user;
  }

  private async getAppointmentForUser(appointmentId: string, userId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { client: { select: { linkedUserId: true } }, moodboard: { include: { images: true } }, tattooDetail: true },
    });
    if (!appointment) throw new NotFoundException('Rendez-vous introuvable.');
    if (appointment.userId !== userId && appointment.performerUserId !== userId) {
      throw new ForbiddenException('Accès refusé à ce rendez-vous.');
    }
    return appointment;
  }

  private async resolveClient(salonId: string, clientId?: string, clientUserId?: string) {
    if (clientId && clientUserId) throw new BadRequestException('Choisissez une seule fiche client.');
    if (clientId) {
      const client = await this.prisma.client.findFirst({ where: { id: clientId, userId: salonId } });
      if (!client) throw new BadRequestException('Ce client ne dépend pas du salon concerné.');
      return { clientId: client.id, clientUserId: client.linkedUserId };
    }
    if (clientUserId) {
      const client = await this.prisma.user.findFirst({ where: { id: clientUserId, role: 'client' } });
      if (!client) throw new BadRequestException('Compte client introuvable.');
      const local = await this.prisma.client.findFirst({ where: { userId: salonId, linkedUserId: clientUserId } });
      return { clientId: local?.id ?? null, clientUserId };
    }
    return { clientId: null, clientUserId: null };
  }

  private sameClient(
    card: { clientId?: string | null; clientUserId?: string | null; client?: { linkedUserId?: string | null } | null },
    appointment: { clientId?: string | null; clientUserId?: string | null; client?: { linkedUserId?: string | null } | null },
  ) {
    const cardUser = card.clientUserId ?? card.client?.linkedUserId;
    const appointmentUser = appointment.clientUserId ?? appointment.client?.linkedUserId;
    if (!card.clientId && !cardUser) return true;
    if (!appointment.clientId && !appointmentUser) return true;
    return Boolean((card.clientId && card.clientId === appointment.clientId) || (cardUser && cardUser === appointmentUser));
  }

  // A card can start independently; choosing an existing RDV adopts its client.
  async createCard(userId: string, dto: CreateDrawingCardDto) {
    const professional = await this.requireProfessional(userId);
    const appointment = dto.sourceAppointmentId ? await this.getAppointmentForUser(dto.sourceAppointmentId, userId) : null;
    const salonId = appointment?.userId ?? userId;
    const client = await this.resolveClient(salonId, dto.clientId, dto.clientUserId);
    if (appointment && !this.sameClient(client, appointment)) throw new BadRequestException('Le client choisi ne correspond pas à celui du rendez-vous.');
    const title = dto.title?.trim() || appointment?.title;
    if (!title) throw new BadRequestException('Le titre du suivi est obligatoire sans rendez-vous.');

    return this.prisma.$transaction(async (tx) => {
      if (appointment) await this.ensureAppointmentAvailable(tx, appointment.id);
      return tx.drawingCard.create({ data: {
        salonId,
        sourceAppointmentId: appointment?.id,
        clientId: appointment?.clientId ?? client.clientId,
        clientUserId: appointment?.clientUserId ?? appointment?.client?.linkedUserId ?? client.clientUserId,
        tatoueurId: appointment?.tatoueurId,
        performerUserId: appointment?.performerUserId ?? (professional.role === 'user_tatoueur' ? userId : undefined),
        title,
        description: dto.description ?? appointment?.tattooDetail?.description,
        additionalInfo: dto.additionalInfo,
        images: appointment?.moodboard?.images.length
          ? { create: appointment.moodboard.images.map((image) => ({ url: image.url, caption: image.caption, uploadedById: userId })) }
          : undefined,
      }, include: this.cardInclude });
    });
  }

  private async ensureAppointmentAvailable(tx: Prisma.TransactionClient, appointmentId: string, cardId?: string, replaceCardId?: string, userId?: string) {
    await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${appointmentId} FOR UPDATE`;
    const existing = await tx.drawingCard.findFirst({ where: {
      OR: [{ sourceAppointmentId: appointmentId }, { tattooAppointmentId: appointmentId }],
      ...(cardId ? { id: { not: cardId } } : {}),
    } });
    if (!existing) return;
    if (existing.id !== replaceCardId) throw new ConflictException('Une card est déjà reliée à ce rendez-vous. Rechargez les rendez-vous et confirmez le remplacement de la card actuellement associée.');
    if (!userId || (existing.salonId !== userId && existing.performerUserId !== userId)) {
      throw new ForbiddenException('Vous ne pouvez pas remplacer une card à laquelle vous n’avez pas accès.');
    }
    // Unlink only this RDV. Keep the previous card, its client and all versions.
    await tx.drawingCard.update({ where: { id: existing.id }, data: {
      ...(existing.sourceAppointmentId === appointmentId ? { sourceAppointmentId: null } : {}),
      ...(existing.tattooAppointmentId === appointmentId ? { tattooAppointmentId: null } : {}),
    } });
  }

  async getAppointmentOptions(userId: string, options: { clientId?: string; clientUserId?: string; cardId?: string } = {}) {
    const card = options.cardId ? await this.getCardForUser(options.cardId, userId) : null;
    const client = await this.resolveClient(card?.salonId ?? userId, options.clientId, options.clientUserId);
    const clientFilters: Prisma.AppointmentWhereInput[] = [];
    if (client.clientId) clientFilters.push({ clientId: client.clientId });
    if (client.clientUserId) clientFilters.push({ clientUserId: client.clientUserId }, { client: { linkedUserId: client.clientUserId } });
    return this.prisma.appointment.findMany({
      where: { AND: [
        { OR: [{ userId }, { performerUserId: userId }] },
        ...(card ? [{ userId: card.salonId }] : [{ drawingCardSource: null, drawingCardTattoo: null }]),
        ...(clientFilters.length ? [{ OR: clientFilters }] : []),
      ] },
      select: { id: true, title: true, start: true, end: true, prestation: true, clientId: true, clientUserId: true, client: { select: { firstName: true, lastName: true } }, clientUser: { select: { firstName: true, lastName: true } }, drawingCardSource: { select: { id: true, title: true } }, drawingCardTattoo: { select: { id: true, title: true } } },
      orderBy: { start: 'desc' },
    });
  }

  async getLinkableCards(appointmentId: string, userId: string) {
    const appointment = await this.getAppointmentForUser(appointmentId, userId);
    const cards = await this.getCards(userId);
    return cards.filter(card => card.salonId === appointment.userId && (
      !card.sourceAppointmentId || (appointment.prestation === PrestationType.TATTOO && card.status === DrawingCardStatus.APPROUVE && !card.tattooAppointmentId)
    ));
  }

  async linkAppointment(cardId: string, appointmentId: string, userId: string, asTattoo = false) {
    const card = await this.getCardForUser(cardId, userId);
    if (asTattoo && card.status !== DrawingCardStatus.APPROUVE) throw new BadRequestException('Seule une card approuvée peut être reliée à un RDV Tattoo.');
    const appointment = await this.getAppointmentForUser(appointmentId, userId);
    if (card.salonId !== appointment.userId) throw new BadRequestException('La card et le rendez-vous doivent dépendre du même professionnel.');
    if (!this.sameClient(card, appointment)) throw new BadRequestException('Impossible de relier cette card : son client est différent de celui du rendez-vous. Choisissez une autre card ou modifiez ses liaisons.');
    for (const existingId of [card.sourceAppointmentId, card.tattooAppointmentId]) {
      if (!existingId || existingId === appointmentId) continue;
      const existingAppointment = await this.getAppointmentForUser(existingId, userId);
      if (!this.sameClient(existingAppointment, appointment)) throw new BadRequestException('Le rendez-vous déjà associé à cette card concerne un autre client. Modifiez ses liaisons avant de continuer.');
    }
    if (card.sourceAppointmentId === appointmentId || card.tattooAppointmentId === appointmentId) return card;
    const tattoo = asTattoo || Boolean(card.sourceAppointmentId);
    if (tattoo && (appointment.prestation !== PrestationType.TATTOO || card.status !== DrawingCardStatus.APPROUVE || card.tattooAppointmentId)) {
      throw new BadRequestException('Cette card possède déjà un rendez-vous. Seul un RDV Tattoo peut être ajouté à un dessin approuvé.');
    }
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "DrawingCard" WHERE id = ${cardId} FOR UPDATE`;
      await this.ensureAppointmentAvailable(tx, appointmentId, cardId);
      const update = await tx.drawingCard.updateMany({
        where: { id: cardId, status: card.status, clientId: card.clientId, clientUserId: card.clientUserId, sourceAppointmentId: card.sourceAppointmentId, tattooAppointmentId: card.tattooAppointmentId },
        data: {
          ...(tattoo ? { tattooAppointmentId: appointmentId } : { sourceAppointmentId: appointmentId }),
          clientId: card.clientId ?? appointment.clientId,
          clientUserId: card.clientUserId ?? card.client?.linkedUserId ?? appointment.clientUserId ?? appointment.client?.linkedUserId,
          tatoueurId: card.tatoueurId ?? appointment.tatoueurId,
          performerUserId: card.performerUserId ?? appointment.performerUserId,
        },
      });
      if (!update.count) throw new ConflictException('Cette card vient d’être reliée à un autre rendez-vous. Actualisez la liste.');
      return tx.drawingCard.findUniqueOrThrow({ where: { id: cardId }, include: this.cardInclude });
    });
  }

  async updateAssociations(cardId: string, userId: string, dto: UpdateDrawingAssociationsDto) {
    await this.getCardForUser(cardId, userId);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "DrawingCard" WHERE id = ${cardId} FOR UPDATE`;
      const card = await tx.drawingCard.findUniqueOrThrow({ where: { id: cardId }, include: { client: { select: { linkedUserId: true } } } });
      if (dto.expectedUpdatedAt && card.updatedAt.getTime() !== new Date(dto.expectedUpdatedAt).getTime()) {
        throw new ConflictException('Cette card a été modifiée. Actualisez la page pour recharger ses liaisons avant de réessayer.');
      }
      const sourceId = dto.sourceAppointmentId === undefined ? card.sourceAppointmentId : dto.sourceAppointmentId;
      const tattooId = dto.tattooAppointmentId === undefined ? card.tattooAppointmentId : dto.tattooAppointmentId;
      if (sourceId && sourceId === tattooId) throw new BadRequestException('Choisissez deux rendez-vous différents.');
      const clientChanged = dto.clientId !== undefined || dto.clientUserId !== undefined;
      const client = await this.resolveClient(card.salonId,
        (clientChanged ? dto.clientId : card.clientId) || undefined,
        (clientChanged ? dto.clientUserId : card.clientId ? undefined : card.clientUserId) || undefined,
      );
      const source = sourceId ? await this.getAppointmentForUser(sourceId, userId) : null;
      const tattoo = tattooId ? await this.getAppointmentForUser(tattooId, userId) : null;
      for (const appointment of [source, tattoo]) {
        if (!appointment) continue;
        if (appointment.userId !== card.salonId) throw new BadRequestException('Le rendez-vous doit dépendre du même professionnel que la card.');
        if (!this.sameClient(client, appointment)) throw new BadRequestException('Le client de la card est différent de celui du rendez-vous. Choisissez le même client ou retirez le rendez-vous avant de modifier le client.');
      }
      if (source && tattoo && !this.sameClient(source, tattoo)) throw new BadRequestException('Les deux rendez-vous concernent des clients différents.');
      if (tattoo && tattoo.prestation !== PrestationType.TATTOO) throw new BadRequestException('Le rendez-vous Tattoo doit être une prestation Tattoo.');
      // Lock appointments in stable order before checking either relation.
      for (const id of [sourceId, tattooId].filter((id): id is string => Boolean(id)).sort()) {
        await this.ensureAppointmentAvailable(tx, id, cardId, id === sourceId ? dto.replaceSourceCardId : dto.replaceTattooCardId, userId);
      }
      const finalClient = {
        clientId: client.clientId ?? source?.clientId ?? tattoo?.clientId ?? null,
        clientUserId: client.clientUserId ?? source?.clientUserId ?? source?.client?.linkedUserId ?? tattoo?.clientUserId ?? tattoo?.client?.linkedUserId ?? null,
      };
      const previousUser = card.clientUserId ?? card.client?.linkedUserId;
      const samePerson = Boolean(
        (card.clientId && card.clientId === finalClient.clientId) ||
        (previousUser && previousUser === finalClient.clientUserId) ||
        (!card.clientId && !previousUser && !finalClient.clientId && !finalClient.clientUserId),
      );
      if (!samePerson) {
        const sending = await tx.drawingCardImage.findFirst({ where: { cardId, deliveryClaimedAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
        if (sending) throw new ConflictException('Une version est en cours d’envoi. Attendez la fin de l’envoi avant de changer de client.');
        await tx.drawingCardImage.updateMany({ where: { cardId }, data: { clientEmailSentAt: null, clientMessageSentAt: null, isApproved: false } });
      }
      return tx.drawingCard.update({ where: { id: cardId }, data: {
        sourceAppointmentId: sourceId,
        tattooAppointmentId: tattooId,
        ...finalClient,
        ...(!samePerson ? { approvedAt: null, ...(card.status === DrawingCardStatus.APPROUVE ? { status: DrawingCardStatus.TERMINE } : {}) } : {}),
      }, include: this.cardInclude });
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

    const card = await this.prisma.drawingCard.findFirst({
      where: { OR: [{ sourceAppointmentId: appointmentId }, { tattooAppointmentId: appointmentId }] },
      select: { id: true, status: true },
    });
    const canCreate = true;

    return {
      appointmentId,
      appointmentCompleted: appointment.status === 'COMPLETED',
      canCreate,
      cardExists: !!card,
      cardId: card?.id ?? null,
      cardStatus: card?.status ?? null,
      latestImage: card ? await this.prisma.drawingCardImage.findFirst({
        where: { cardId: card.id },
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
      }) : null,
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
    return this.linkAppointment(cardId, appointmentId, userId, true);
  }
}
