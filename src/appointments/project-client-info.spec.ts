import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { projectClientInfoData } from './project-client-info';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { ProjectClientInfoDto } from './dto/project-client-info.dto';
import { desiredPeriodData } from './desired-tattoo-period';

describe('Project budget and first tattoo', () => {
  it.each([
    { projectBudgetMinCents: null, projectBudgetMaxCents: 20000 },
    { projectBudgetMinCents: 20000, projectBudgetMaxCents: 50000 },
    { projectBudgetMinCents: 50000, projectBudgetMaxCents: null },
    { projectBudgetMinCents: 0, projectBudgetMaxCents: 0 },
    { projectBudgetMinCents: null, projectBudgetMaxCents: null },
  ])('supports frontend budget options %j', input => {
    expect(projectClientInfoData(input, 'PROJET')).toEqual(input);
  });
  it.each([true, false, null])('preserves the first tattoo value %j', isFirstTattoo => {
    expect(projectClientInfoData({ isFirstTattoo }, 'PROJET')).toEqual({ isFirstTattoo });
  });
  it('keeps omissions and other metadata independent', () => {
    expect(projectClientInfoData({}, 'PROJET')).toEqual({});
    expect(projectClientInfoData({ isFirstTattoo: false }, 'PROJET')).not.toHaveProperty('projectBudgetMinCents');
    expect(desiredPeriodData(Object.assign(new CreateAppointmentDto(), { isFirstTattoo: true, projectBudgetMaxCents: 20000 }), 'PROJET')).toEqual({});
    expect(projectClientInfoData({ projectBudgetMaxCents: 20000 }, 'PROJET')).toEqual({ projectBudgetMinCents: null, projectBudgetMaxCents: 20000 });
  });
  it.each([
    { projectBudgetMinCents: -1 }, { projectBudgetMaxCents: 1.5 },
    { projectBudgetMinCents: 50000, projectBudgetMaxCents: 20000 },
    { projectBudgetMaxCents: 2147483648 },
  ])('rejects invalid budgets %j', input => {
    expect(() => projectClientInfoData(input, 'PROJET')).toThrow();
  });
  it.each(['TATTOO', 'PIERCING', 'RETOUCHE'])('rejects project metadata on %s', prestation => {
    expect(() => projectClientInfoData({ isFirstTattoo: true }, prestation)).toThrow();
  });
  it('rejects string booleans and currency strings at the DTO boundary', () => {
    const dto = plainToInstance(ProjectClientInfoDto, { isFirstTattoo: 'false', projectBudgetMaxCents: '20000' });
    expect(validateSync(dto).map(e => e.property).sort()).toEqual(['isFirstTattoo', 'projectBudgetMaxCents']);
  });
});
