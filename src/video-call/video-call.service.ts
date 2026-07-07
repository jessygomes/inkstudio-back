import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class VideoCallService {
  private readonly jitsiDomain = 'meet.jit.si';
  private readonly roomNamePattern = /^[a-z0-9-]+-rdv-[a-z0-9]{1,8}-[a-f0-9]{8}$/;

  getLobbyActivationInstruction(): string {
    return 'Active le mode salle d\'attente avant de partager ce lien.';
  }

  private buildBaseRoomName(appointmentId: string, salonName?: string): string {
    const roomId = crypto.randomBytes(16).toString('hex');
    const sanitizedSalonName = salonName
      ? salonName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
      : 'salon';

    return `${sanitizedSalonName}-rdv-${appointmentId.slice(-8)}-${roomId.slice(0, 8)}`;
  }

  private applyDefaultJitsiSecurityParams(url: URL): void {
    // Préjoin + lobby: l'utilisateur ne rejoint pas immédiatement la salle.
    url.searchParams.set('config.prejoinPageEnabled', 'true');
    url.searchParams.set('config.enableLobby', 'true');
    // Active l'UI sécurité pour faciliter l'activation du lobby côté hôte.
    url.searchParams.set('config.securityUi.enabled', 'true');
  }

  /**
   * Génère un lien de visioconférence unique
   * Utilise Jitsi Meet pour créer une salle de réunion sécurisée
   * @param appointmentId - ID du rendez-vous pour personnaliser le nom de la salle
   * @param salonName - Nom du salon pour personnaliser le nom de la salle
   * @returns URL de la salle de visioconférence
   */
  generateVideoCallLink(appointmentId: string, salonName?: string): string {
    const roomName = this.buildBaseRoomName(appointmentId, salonName);
    const url = new URL(`https://${this.jitsiDomain}/${roomName}`);

    this.applyDefaultJitsiSecurityParams(url);

    return url.toString();
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
   * @param expectedAppointmentId - optionnel, force la correspondance du suffixe d'ID RDV
   * @returns boolean
   */
  isValidVideoCallUrl(videoCallUrl: string, expectedAppointmentId?: string): boolean {
    try {
      const url = new URL(videoCallUrl);
      const roomName = this.extractRoomNameFromUrl(videoCallUrl);
      if (!roomName) {
        return false;
      }

      if (url.protocol !== 'https:') {
        return false;
      }

      if (url.hostname.toLowerCase() !== this.jitsiDomain) {
        return false;
      }

      if (!this.roomNamePattern.test(roomName)) {
        return false;
      }

      if (expectedAppointmentId) {
        const appointmentSuffix = expectedAppointmentId.slice(-8).toLowerCase();
        if (!roomName.includes(`-rdv-${appointmentSuffix}-`)) {
          return false;
        }
      }

      return true;
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
    const roomName = this.buildBaseRoomName(appointmentId, salonName);
    const url = new URL(`https://${this.jitsiDomain}/${roomName}`);

    this.applyDefaultJitsiSecurityParams(url);

    // Ajouter des paramètres personnalisés si fournis
    if (participantName) {
      url.searchParams.set('userInfo.displayName', participantName);
    }

    // Paramètres Jitsi pour améliorer l'expérience
    url.searchParams.set('config.startWithAudioMuted', 'true');
    url.searchParams.set('config.startWithVideoMuted', 'false');

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
      if (url.hostname.toLowerCase() === this.jitsiDomain) {
        const roomName = url.pathname.slice(1); // Retirer le "/" du début
        return roomName || null;
      }
      return null;
    } catch {
      return null;
    }
  }
}
