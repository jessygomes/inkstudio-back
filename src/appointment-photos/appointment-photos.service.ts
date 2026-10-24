import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { AddAppointmentPhotosDto } from './dto/add-appointment-photos.dto';

@Injectable()
export class AppointmentPhotosService {
  constructor(private readonly prisma: PrismaService) {}

  private async authorize(appointmentId: string, userId: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new NotFoundException('Rendez-vous introuvable.');
    if (appointment.userId !== userId && appointment.performerUserId !== userId) {
      throw new ForbiddenException('Accès refusé aux photos de ce rendez-vous.');
    }
    return appointment;
  }

  private include = { portfolios: { select: { id: true, userId: true } } };

  async list(appointmentId: string, userId: string) {
    await this.authorize(appointmentId, userId);
    return this.prisma.appointmentPhoto.findMany({
      where: { appointmentId }, include: this.include, orderBy: { createdAt: 'asc' },
    });
  }

  async add(appointmentId: string, userId: string, dto: AddAppointmentPhotosDto) {
    await this.authorize(appointmentId, userId);
    return this.prisma.$transaction(dto.photos.map((photo) => this.prisma.appointmentPhoto.create({
      data: { appointmentId, url: photo.url, caption: photo.caption }, include: this.include,
    })));
  }

  async remove(appointmentId: string, photoId: string, userId: string) {
    await this.authorize(appointmentId, userId);
    const result = await this.prisma.appointmentPhoto.deleteMany({ where: { id: photoId, appointmentId } });
    if (!result.count) throw new NotFoundException('Photo introuvable.');
    return { error: false };
  }

  async forClient(clientId: string, userId: string) {
    const client = await this.prisma.client.findFirst({ where: { id: clientId, userId }, select: { id: true } });
    if (!client) throw new NotFoundException('Client introuvable.');
    return this.prisma.appointmentPhoto.findMany({
      where: { appointment: { clientId, OR: [{ userId }, { performerUserId: userId }] } },
      include: { ...this.include, appointment: { select: { id: true, title: true, start: true, prestation: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
