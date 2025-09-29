import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class VideoCallService {
  /**
   * Génère un lien de visioconférence unique
   * Utilise Jitsi Meet pour créer une salle de réunion sécurisée
   * @param appointmentId - ID du rendez-vous pour personnaliser le nom de la salle
   * @param salonName - Nom du salon pour personnaliser le nom de la salle
   * @returns URL de la salle de visioconférence
   */
  generateVideoCallLink(appointmentId: string, salonName?: string): string {
    // Générer un ID unique pour la salle
    const roomId = crypto.randomBytes(16).toString('hex');

    // Créer un nom de salle unique et sécurisé
    const sanitizedSalonName = salonName
      ? salonName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
      : 'salon';

    const roomName = `${sanitizedSalonName}-rdv-${appointmentId.slice(-8)}-${roomId.slice(0, 8)}`;

    // Utiliser Jitsi Meet comme plateforme de visioconférence
    const jitsiDomain = 'meet.jit.si';
    const videoCallUrl = `https://${jitsiDomain}/${roomName}`;

    return videoCallUrl;
  }

  /**
   * Génère un nom de salle simple basé sur l'ID du rendez-vous
   * @param appointmentId - ID du rendez-vous
   * @returns Nom de la salle de visioconférence
   */
  generateRoomName(appointmentId: string): string {
    const timestamp = Date.now().toString(36);
    const shortId = appointmentId.slice(-8);
    return `rdv-${shortId}-${timestamp}`;
  }

  /**
   * Valide si un lien de visioconférence est valide
   * @param videoCallUrl - URL à valider
   * @returns boolean
   */
  isValidVideoCallUrl(videoCallUrl: string): boolean {
    try {
      const url = new URL(videoCallUrl);
      return url.hostname === 'meet.jit.si' && url.pathname.length > 1;
    } catch {
      return false;
    }
  }

  /**
   * Génère un lien avec des paramètres personnalisés pour Jitsi Meet
   * @param appointmentId - ID du rendez-vous
   * @param participantName - Nom du participant (optionnel)
   * @param salonName - Nom du salon (optionnel)
   * @returns URL complète avec paramètres
   */
  generateCustomVideoCallLink(
    appointmentId: string,
    participantName?: string,
    salonName?: string,
  ): string {
    const baseUrl = this.generateVideoCallLink(appointmentId, salonName);
    const url = new URL(baseUrl);

    // Ajouter des paramètres personnalisés si fournis
    if (participantName) {
      url.searchParams.set('userInfo.displayName', participantName);
    }

    // Paramètres Jitsi pour améliorer l'expérience
    url.searchParams.set('config.startWithAudioMuted', 'true');
    url.searchParams.set('config.startWithVideoMuted', 'false');
    url.searchParams.set('config.prejoinPageEnabled', 'true');

    return url.toString();
  }

  /**
   * Extrait le nom de la salle depuis une URL Jitsi
   * @param videoCallUrl - URL de la salle
   * @returns Nom de la salle ou null si invalide
   */
  extractRoomNameFromUrl(videoCallUrl: string): string | null {
    try {
      const url = new URL(videoCallUrl);
      if (url.hostname === 'meet.jit.si') {
        return url.pathname.slice(1); // Retirer le "/" du début
      }
      return null;
    } catch {
      return null;
    }
  }
}
