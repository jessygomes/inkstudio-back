import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TattooPracticesDto } from './dto/tattoo-practices.dto';
import { UpdateAppointmentBookingDto } from './dto/update-confirmation-setting.dto';
import { publicUserProfile } from './public-user-profile';
import { UserService } from './user.service';

describe('Tattoo practices and booking settings', () => {
  it('accepts multiple practices, custom details, and explicit clearing', () => {
    for (const body of [{ tattooPractices: ['MACHINE', 'HANDPOKE'], tattooPracticeDetails: 'Selon le projet' }, { tattooPractices: [], tattooPracticeDetails: null }])
      expect(validateSync(plainToInstance(TattooPracticesDto, body))).toEqual([]);
  });
  it.each([['UNKNOWN'], ['MACHINE', 'MACHINE'], null, 'MACHINE'])('rejects invalid practice arrays %j', tattooPractices => {
    expect(validateSync(plainToInstance(TattooPracticesDto, { tattooPractices })).length).toBeGreaterThan(0);
  });
  it('allows false but rejects null and strings for same-day booking', () => {
    expect(validateSync(plainToInstance(UpdateAppointmentBookingDto, { allowSameDayBooking: false }))).toEqual([]);
    for (const value of [null, 'false']) expect(validateSync(plainToInstance(UpdateAppointmentBookingDto, { allowSameDayBooking: value })).length).toBeGreaterThan(0);
  });
  it('includes practices and same-day policy in safe public profiles', () => {
    const profile = publicUserProfile({ role: 'user_tatoueur', publicVisibility: 'VISIBLE', tattooPractices: ['HANDPOKE'], tattooPracticeDetails: 'Texte public', allowSameDayBooking: false, password: 'secret', Tatoueur: [{ tattooPractices: ['MACHINE'], tattooPracticeDetails: null }] });
    expect(profile).toMatchObject({ tattooPractices: ['HANDPOKE'], allowSameDayBooking: false, Tatoueur: [{ tattooPractices: ['MACHINE'] }] });
    expect(profile).not.toHaveProperty('password');
  });
  it('persists false through the existing settings service without overwriting project options', async () => {
    const db = { user: { findUnique: jest.fn().mockResolvedValue({ role: 'user_salon', saasPlan: 'PRO', allowSameDayBooking: true, projectAppointmentDurationMinutes: 45, projectAppointmentIsFree: true }), update: jest.fn() }, saasPlanDetails: { upsert: jest.fn() } };
    const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn(), delPattern: jest.fn() };
    const service = new UserService(db as any, cache as any, {} as any);
    const result = await service.updateAppointmentBooking({ userId: 'salon', allowSameDayBooking: false });
    expect(result).toMatchObject({ error: false, user: { allowSameDayBooking: false, projectAppointmentDurationMinutes: 45 } });
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ allowSameDayBooking: false }) }));
  });
});
