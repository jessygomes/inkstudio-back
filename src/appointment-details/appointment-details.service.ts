import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentPhotosService } from '../appointment-photos/appointment-photos.service';
import { SuiviService } from '../suivi/suivi.service';
import type { DashboardSection } from '../dashboard/dashboard.service';

@Injectable()
export class AppointmentDetailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointments: AppointmentsService,
    private readonly photos: AppointmentPhotosService,
    private readonly drawing: SuiviService,
  ) {}

  private async guard<T>(run: () => Promise<T>): Promise<DashboardSection<T>> {
    try {
      return { ok: true, data: await run() };
    } catch (e) {
      const status = typeof (e as { getStatus?: () => number })?.getStatus === 'function' ? (e as { getStatus: () => number }).getStatus() : 500;
      return { ok: false, status, message: e instanceof Error ? e.message : 'Une erreur est survenue.' };
    }
  }

  /** `GET /appointments/:id` ne renvoie ni le client ni la conversation (les listes, oui) : on les ajoute ici. */
  private async withClient(id: string) {
    const base = (await this.appointments.getOneAppointment(id)) as ({ id?: string; error?: boolean; message?: string } & Record<string, unknown>) | null;
    if (!base) throw new Error('Rendez-vous introuvable.');
    if (base.error) throw new Error(base.message || 'Rendez-vous introuvable.');
    const extra = await this.prisma.appointment.findUnique({
      where: { id },
      select: {
        client: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            // Photo de profil du compte Inkera People lié à la fiche, s'il existe.
            linkedUser: { select: { image: true } },
          },
        },
        conversation: { select: { id: true } },
      },
    });
    return { ...base, client: extra?.client ?? null, conversation: extra?.conversation ?? null };
  }

  /**
   * Tout ce que la fiche d'un rendez-vous affiche, en une réponse : le rendez-vous (avec client et conversation),
   * ses photos et l'état de son suivi de dessin. L'accès est vérifié d'abord (refus = erreur globale) ;
   * ensuite chaque bloc réussit ou échoue seul.
   */
  async get(userId: string, id: string) {
    await this.appointments.assertAppointmentAccess(id, userId, false);
    const [appointment, photos, drawingStatus] = await Promise.all([
      this.guard(() => this.withClient(id)),
      this.guard(() => this.photos.list(id, userId)),
      this.guard(() => this.drawing.getAppointmentCardStatus(id, userId)),
    ]);
    return { appointment, photos, drawingStatus };
  }
}
