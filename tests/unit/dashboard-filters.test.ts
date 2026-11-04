import { describe, expect, it } from 'vitest';
import { DashboardQueryFiltersSchema } from '@ia-governanca/contracts';

describe('filtros globais do dashboard', () => {
  it('aceita filtros combinados para um tenant autorizado', () => {
    const parsed = DashboardQueryFiltersSchema.safeParse({
      organizationId: 'aa3cb5eb-cbf5-4bab-9dd4-529bb69466ce',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      projectId: '6a988983-07e6-40da-a1a6-640da5f2b792',
      teamId: 'faac7e3a-6c8c-4600-92a1-8fe1ab95045c',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      costCategory: 'simulated',
      dataSource: 'gateway_local',
    });

    expect(parsed.success).toBe(true);
  });

  it('rejeita intervalo invertido, UUID inválido e origem desconhecida', () => {
    expect(DashboardQueryFiltersSchema.safeParse({
      startDate: '2026-11-01',
      endDate: '2026-10-31',
    }).success).toBe(false);
    expect(DashboardQueryFiltersSchema.safeParse({ projectId: 'not-a-uuid' }).success).toBe(false);
    expect(DashboardQueryFiltersSchema.safeParse({ dataSource: 'unknown' }).success).toBe(false);
  });
});
