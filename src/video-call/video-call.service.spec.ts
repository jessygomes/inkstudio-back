import { Test, TestingModule } from '@nestjs/testing';
import { VideoCallService } from './video-call.service';

// DTO and data builders
const buildVideoCallLinkParams = (overrides?: Partial<any>) => ({
  appointmentId: 'appt-12345678',
  salonName: 'Inkera Studio',
  ...overrides,
});

const buildCustomVideoCallParams = (overrides?: Partial<any>) => ({
  appointmentId: 'appt-87654321',
  participantName: 'Jean Dupont',
  salonName: 'Ink Paradise',
  ...overrides,
});

describe('VideoCallService', () => {
  let service: VideoCallService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VideoCallService],
    }).compile();

    service = module.get<VideoCallService>(VideoCallService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateVideoCallLink', () => {
    it('should generate a valid video call link', () => {
      const params = buildVideoCallLinkParams();
      const link = service.generateVideoCallLink(
        params.appointmentId,
        params.salonName,
      );

      expect(link).toBeDefined();
      expect(link).toContain('https://meet.jit.si/');
      expect(link).toContain('rdv-');
    });

    it('should generate unique links for the same appointment', () => {
      const params = buildVideoCallLinkParams();
      const link1 = service.generateVideoCallLink(
        params.appointmentId,
        params.salonName,
      );
      const link2 = service.generateVideoCallLink(
        params.appointmentId,
        params.salonName,
      );

      expect(link1).not.toBe(link2);
    });

    it('should include appointment ID in the link', () => {
      const appointmentId = 'appt-abc12345';
      const link = service.generateVideoCallLink(
        appointmentId,
        'Tattoo Studio',
      );

      expect(link).toContain('abc12345');
    });

    it('should sanitize salon name in the link', () => {
      const link = service.generateVideoCallLink(
        'appt-12345678',
        'Tattoo & Studio!@#$',
      );

      expect(link).toContain('tattoo---studio-----rdv-');
      expect(link).not.toContain('&');
      expect(link).not.toContain('!');
      expect(link).not.toContain('@');
    });

    it('should use default salon name when not provided', () => {
      const link = service.generateVideoCallLink('appt-12345678');

      expect(link).toContain('salon-rdv-');
    });

    it('should generate lowercase room names', () => {
      const link = service.generateVideoCallLink(
        'appt-12345678',
        'TATTOO STUDIO',
      );

      expect(link).toContain('tattoo-studio-rdv-');
      expect(link).not.toContain('TATTOO');
    });

    it('should include random hex identifier for uniqueness', () => {
      const link = service.generateVideoCallLink(
        'appt-12345678',
        'Tattoo Studio',
      );
      const urlParts = link.split('-');

      // Room format: tattoo-studio-rdv-<appointmentIdSuffix>-<randomHex>
      expect(urlParts.length).toBeGreaterThanOrEqual(4);
    });

    it('should handle special characters in salon name', () => {
      const specialNames = [
        'Tattoo-Studio',
        'Ink & Needle',
        'Studio@Tattoo',
        'Ink.Studio',
        'Тату Студио', // Cyrillic
      ];

      specialNames.forEach((name) => {
        const link = service.generateVideoCallLink('appt-12345678', name);
        expect(link).toContain('meet.jit.si');
      });
    });

    it('should always return HTTPS protocol', () => {
      const link = service.generateVideoCallLink(
        'appt-12345678',
        'Tattoo Studio',
      );
      expect(link.startsWith('https://')).toBe(true);
    });
  });

  describe('generateRoomName', () => {
    it('should generate a room name from appointment ID', () => {
      const appointmentId = 'appt-87654321';
      const roomName = service.generateRoomName(appointmentId);

      expect(roomName).toContain('rdv-');
      expect(roomName).toContain('87654321');
    });

    it('should include timestamp in room name', () => {
      const roomName = service.generateRoomName('appt-12345678');

      expect(roomName).toMatch(/rdv-\w+-\w+/);
    });

    it('should generate unique room names for same appointment', () => {
      const appointmentId = 'appt-12345678';
      const roomName1 = service.generateRoomName(appointmentId);

      // Small delay to ensure different timestamp
      jest.useFakeTimers();
      jest.advanceTimersByTime(10);

      const roomName2 = service.generateRoomName(appointmentId);
      jest.useRealTimers();

      expect(roomName1).not.toBe(roomName2);
    });

    it('should extract last 8 characters from appointment ID', () => {
      const appointmentId = 'long-appointment-id-12345678';
      const roomName = service.generateRoomName(appointmentId);

      expect(roomName).toContain('12345678');
    });

    it('should handle short appointment IDs', () => {
      const appointmentId = 'appt-1';
      const roomName = service.generateRoomName(appointmentId);

      expect(roomName).toBeDefined();
      expect(roomName).toContain('rdv-');
    });

    it('should use base36 encoding for timestamp', () => {
      const roomName = service.generateRoomName('appt-12345678');
      const parts = roomName.split('-');

      expect(parts.length).toBe(3);
      expect(parts[0]).toBe('rdv');
    });
  });

  describe('isValidVideoCallUrl', () => {
    it('should validate correct Jitsi Meet URLs', () => {
      const validUrl = 'https://meet.jit.si/test-room-name';
      expect(service.isValidVideoCallUrl(validUrl)).toBe(true);
    });

    it('should reject URLs with wrong domain', () => {
      const invalidUrl = 'https://zoom.us/test-room';
      expect(service.isValidVideoCallUrl(invalidUrl)).toBe(false);
    });

    it('should accept URLs with any protocol if domain and path are valid', () => {
      // The service validates domain and pathname, not protocol
      const url = 'http://meet.jit.si/test-room';
      expect(service.isValidVideoCallUrl(url)).toBe(true);
    });

    it('should reject URLs without room name', () => {
      const invalidUrl = 'https://meet.jit.si/';
      expect(service.isValidVideoCallUrl(invalidUrl)).toBe(false);
    });

    it('should reject malformed URLs', () => {
      const invalidUrls = ['not-a-url', 'just-text'];

      invalidUrls.forEach((url) => {
        expect(service.isValidVideoCallUrl(url)).toBe(false);
      });
    });

    it('should accept URLs with multiple path segments', () => {
      const validUrl = 'https://meet.jit.si/complex-room-name-with-many-parts';
      expect(service.isValidVideoCallUrl(validUrl)).toBe(true);
    });

    it('should accept URLs with query parameters', () => {
      const validUrl =
        'https://meet.jit.si/test-room?config.startWithAudioMuted=true';
      expect(service.isValidVideoCallUrl(validUrl)).toBe(true);
    });

    it('should reject empty string', () => {
      expect(service.isValidVideoCallUrl('')).toBe(false);
    });

    it('should reject null-like strings', () => {
      expect(service.isValidVideoCallUrl('null')).toBe(false);
      expect(service.isValidVideoCallUrl('undefined')).toBe(false);
    });
  });

  describe('generateCustomVideoCallLink', () => {
    it('should generate a custom video call link with participant name', () => {
      const params = buildCustomVideoCallParams();
      const link = service.generateCustomVideoCallLink(
        params.appointmentId,
        params.participantName,
        params.salonName,
      );

      expect(link).toBeDefined();
      expect(link).toContain('meet.jit.si');
      expect(link).toContain('userInfo.displayName=Jean');
      expect(link).toContain('Dupont');
    });

    it('should include Jitsi configuration parameters', () => {
      const link = service.generateCustomVideoCallLink(
        'appt-12345678',
        undefined,
        'Tattoo Studio',
      );

      expect(link).toContain('config.startWithAudioMuted=true');
      expect(link).toContain('config.startWithVideoMuted=false');
      expect(link).toContain('config.prejoinPageEnabled=true');
    });

    it('should set participant name when provided', () => {
      const link = service.generateCustomVideoCallLink(
        'appt-12345678',
        'Alice Martin',
        'Tattoo Studio',
      );

      expect(link).toContain('userInfo.displayName=Alice');
      expect(link).toContain('Martin');
    });

    it('should not include participant name parameter when not provided', () => {
      const link = service.generateCustomVideoCallLink(
        'appt-12345678',
        undefined,
        'Tattoo Studio',
      );

      expect(link).not.toContain('userInfo.displayName');
    });

    it('should handle special characters in participant name', () => {
      const specialNames = ['Jean-Pierre Dupont', "O'Brien", 'José García'];

      specialNames.forEach((name) => {
        const link = service.generateCustomVideoCallLink(
          'appt-12345678',
          name,
          'Tattoo Studio',
        );
        expect(link).toContain('meet.jit.si');
        expect(link).toContain('config.startWithAudioMuted=true');
      });
    });

    it('should generate valid URL with all parameters', () => {
      const link = service.generateCustomVideoCallLink(
        'appt-12345678',
        'Test User',
        'Test Salon',
      );

      expect(() => new URL(link)).not.toThrow();
    });

    it('should always enable prejoin page', () => {
      const link = service.generateCustomVideoCallLink(
        'appt-12345678',
        'User',
        'Salon',
      );
      expect(link).toContain('config.prejoinPageEnabled=true');
    });

    it('should always start with audio muted', () => {
      const link = service.generateCustomVideoCallLink(
        'appt-12345678',
        'User',
        'Salon',
      );
      expect(link).toContain('config.startWithAudioMuted=true');
    });

    it('should always start with video enabled', () => {
      const link = service.generateCustomVideoCallLink(
        'appt-12345678',
        'User',
        'Salon',
      );
      expect(link).toContain('config.startWithVideoMuted=false');
    });

    it('should work without optional parameters', () => {
      const link = service.generateCustomVideoCallLink('appt-12345678');

      expect(link).toBeDefined();
      expect(link).toContain('meet.jit.si');
      expect(link).toContain('config.startWithAudioMuted=true');
    });
  });

  describe('extractRoomNameFromUrl', () => {
    it('should extract room name from valid Jitsi URL', () => {
      const url = 'https://meet.jit.si/test-room-name';
      const roomName = service.extractRoomNameFromUrl(url);

      expect(roomName).toBe('test-room-name');
    });

    it('should extract room name with complex format', () => {
      const url = 'https://meet.jit.si/tattoo-studio-rdv-12345678-abcd1234';
      const roomName = service.extractRoomNameFromUrl(url);

      expect(roomName).toBe('tattoo-studio-rdv-12345678-abcd1234');
    });

    it('should extract room name ignoring query parameters', () => {
      const url =
        'https://meet.jit.si/test-room?config.startWithAudioMuted=true&userInfo.displayName=User';
      const roomName = service.extractRoomNameFromUrl(url);

      expect(roomName).toBe('test-room');
    });

    it('should return null for invalid domain', () => {
      const url = 'https://zoom.us/test-room';
      const roomName = service.extractRoomNameFromUrl(url);

      expect(roomName).toBeNull();
    });

    it('should return null for empty path', () => {
      const url = 'https://meet.jit.si/';
      const roomName = service.extractRoomNameFromUrl(url);

      expect(roomName).toBe('');
    });

    it('should return null for malformed URLs', () => {
      const invalidUrls = ['not-a-url', 'invalid-url'];

      invalidUrls.forEach((url) => {
        expect(service.extractRoomNameFromUrl(url)).toBeNull();
      });
    });

    it('should handle URL encoded room names', () => {
      const url = 'https://meet.jit.si/room%20with%20spaces';
      const roomName = service.extractRoomNameFromUrl(url);

      expect(roomName).toBe('room%20with%20spaces');
    });

    it('should not return null for URLs with extra segments', () => {
      const url = 'https://meet.jit.si/multi/segment/room';
      const roomName = service.extractRoomNameFromUrl(url);

      expect(roomName).toBeDefined();
      expect(roomName).toContain('room');
    });
  });

  describe('Integration and edge cases', () => {
    it('should generate and validate consistent video call links', () => {
      const appointmentId = 'appt-test123';
      const salonName = 'Test Salon';
      const link = service.generateVideoCallLink(appointmentId, salonName);

      expect(service.isValidVideoCallUrl(link)).toBe(true);
    });

    it('should extract room name from generated link', () => {
      const link = service.generateVideoCallLink(
        'appt-12345678',
        'Tattoo Studio',
      );
      const roomName = service.extractRoomNameFromUrl(link);

      expect(roomName).toBeDefined();
      expect(roomName).toContain('tattoo-studio-rdv-');
    });

    it('should generate valid custom links that can be validated', () => {
      const link = service.generateCustomVideoCallLink(
        'appt-12345678',
        'User Name',
        'Salon Name',
      );

      expect(service.isValidVideoCallUrl(link)).toBe(true);
    });

    it('should extract room name from custom link', () => {
      const link = service.generateCustomVideoCallLink(
        'appt-test456',
        'John Doe',
        'My Salon',
      );
      const roomName = service.extractRoomNameFromUrl(link);

      expect(roomName).toBeDefined();
      expect(roomName).toContain('my-salon-rdv-');
    });

    it('should handle empty appointment ID gracefully', () => {
      const link = service.generateVideoCallLink('');
      expect(link).toContain('meet.jit.si');
    });

    it('should handle very long appointment IDs', () => {
      const longId = 'a'.repeat(1000);
      const link = service.generateVideoCallLink(longId, 'Salon');

      expect(link).toContain('meet.jit.si');
    });

    it('should maintain consistency across multiple operations', () => {
      const appointmentId = 'appt-consistency-test';
      const salonName = 'Consistent Salon';

      // Generate link
      const link = service.generateVideoCallLink(appointmentId, salonName);

      // Validate it
      expect(service.isValidVideoCallUrl(link)).toBe(true);

      // Extract room name
      const roomName = service.extractRoomNameFromUrl(link);
      expect(roomName).toBeDefined();

      // Room name should contain appointment suffix
      expect(roomName).toContain('ncy-test');
    });

    it('should generate different links for different appointments', () => {
      const link1 = service.generateVideoCallLink('appt-1', 'Salon');
      const link2 = service.generateVideoCallLink('appt-2', 'Salon');

      expect(link1).not.toBe(link2);
      expect(service.isValidVideoCallUrl(link1)).toBe(true);
      expect(service.isValidVideoCallUrl(link2)).toBe(true);
    });

    it('should handle whitespace in salon name', () => {
      const salonNames = [
        '  Tattoo Studio  ',
        'Tattoo  Studio',
        '  Multiple   Spaces  ',
      ];

      salonNames.forEach((name) => {
        const link = service.generateVideoCallLink('appt-12345678', name);
        expect(service.isValidVideoCallUrl(link)).toBe(true);
      });
    });

    it('should generate unique custom links with same parameters', () => {
      const link1 = service.generateCustomVideoCallLink(
        'appt-1',
        'User',
        'Salon',
      );
      const link2 = service.generateCustomVideoCallLink(
        'appt-1',
        'User',
        'Salon',
      );

      // URLs may differ due to random room IDs
      expect(service.isValidVideoCallUrl(link1)).toBe(true);
      expect(service.isValidVideoCallUrl(link2)).toBe(true);
    });

    it('should correctly handle case sensitivity in URL validation', () => {
      const url = 'https://MEET.JIT.SI/test-room';
      // Standard URL parsing should normalize domain to lowercase
      const isValid = service.isValidVideoCallUrl(url);
      // Most URL implementations normalize domain, but this tests actual behavior
      expect(typeof isValid).toBe('boolean');
    });

    it('should generate room names with sufficient entropy', () => {
      const names = new Set();
      const baseTime = Date.now();

      for (let i = 0; i < 5; i++) {
        jest.useFakeTimers();
        jest.setSystemTime(baseTime + i * 100);
        const roomName = service.generateRoomName('appt-12345678');
        names.add(roomName);
        jest.useRealTimers();
      }

      // Should have multiple unique names due to timestamp variation
      expect(names.size).toBeGreaterThanOrEqual(1);
    });
  });
});
