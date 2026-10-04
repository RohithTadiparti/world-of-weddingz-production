import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlannerService } from './planner.service';
import { WeddingPlan } from './entities/wedding-plan.entity';
import { PlanTask } from './entities/plan-task.entity';
import { User } from '../auth/entities/user.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { AgentsService } from '../agents/agents.service';
import { UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { DEFAULT_TIMELINE_TEMPLATE } from './timeline.template';

const host: AuthUser = {
  userId: 'u1',
  email: 'u1@example.com',
  role: UserRole.BRIDE,
  managedByAgentId: null,
};

describe('PlannerService.createPlan (auto timeline)', () => {
  let service: PlannerService;
  let savedTasks: PlanTask[] = [];

  const plansRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'plan-1', ...x })),
    findOne: jest.fn(async () => ({ id: 'plan-1', userId: 'u1', tasks: savedTasks })),
  };
  const tasksRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (arr) => {
      savedTasks = arr as PlanTask[];
      return savedTasks;
    }),
  };

  beforeEach(async () => {
    savedTasks = [];
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlannerService,
        { provide: getRepositoryToken(WeddingPlan), useValue: plansRepo },
        { provide: getRepositoryToken(PlanTask), useValue: tasksRepo },
        { provide: getRepositoryToken(User), useValue: { find: jest.fn(async () => []), findOne: jest.fn() } },
        { provide: getRepositoryToken(Booking), useValue: { findOne: jest.fn(async () => null) } },
        { provide: getRepositoryToken(PlannerProfile), useValue: { find: jest.fn(async () => []) } },
        { provide: AgentsService, useValue: { assertManages: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(PlannerService);
  });

  it('generates one task per template item, all dated before the wedding', async () => {
    const weddingDate = '2026-12-01';
    await service.createPlan(host, { weddingDate });

    expect(savedTasks).toHaveLength(DEFAULT_TIMELINE_TEMPLATE.length);
    for (const task of savedTasks) {
      expect(new Date(task.dueDate as string).getTime()).toBeLessThan(
        new Date(weddingDate).getTime(),
      );
    }
  });
});

/**
 * The overall budget is the couple's, set on the newest plan. Creating a plan
 * again (to change the date, say) must carry it, or the dashboard, which reads
 * the newest plan, loses it.
 */
describe('PlannerService.createPlan (budget)', () => {
  const build = async (plans: Partial<WeddingPlan>[]) => {
    const saved: Partial<WeddingPlan>[] = [];
    const plansRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => {
        saved.push(x);
        return { id: 'plan-new', ...x };
      }),
      findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id) return { id: where.id, userId: 'u1', tasks: [] };
        const rows = 'weddingDate' in where ? plans.filter((p) => p.weddingDate === null) : plans;
        return rows[0] ?? null;
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlannerService,
        { provide: getRepositoryToken(WeddingPlan), useValue: plansRepo },
        { provide: getRepositoryToken(PlanTask), useValue: { create: jest.fn((x) => x), save: jest.fn(async (x) => x) } },
        { provide: getRepositoryToken(User), useValue: { find: jest.fn(async () => []), findOne: jest.fn() } },
        { provide: getRepositoryToken(Booking), useValue: { findOne: jest.fn(async () => null) } },
        { provide: getRepositoryToken(PlannerProfile), useValue: { find: jest.fn(async () => []) } },
        { provide: AgentsService, useValue: { assertManages: jest.fn() } },
      ],
    }).compile();
    return { service: moduleRef.get(PlannerService), saved };
  };

  it('carries the budget from the newest dated plan onto a new one', async () => {
    const { service, saved } = await build([
      { id: 'plan-1', userId: 'u1', weddingDate: '2026-11-01', budget: '1500000.00' },
    ]);
    await service.createPlan(host, { weddingDate: '2026-12-01' });
    expect(saved[0]).toMatchObject({ weddingDate: '2026-12-01', budget: '1500000.00' });
  });

  it('keeps the budget on an undated plan when it gets its date', async () => {
    const { service, saved } = await build([
      { id: 'plan-1', userId: 'u1', weddingDate: null, budget: '800000.00' },
    ]);
    await service.createPlan(host, { weddingDate: '2026-12-01' });
    expect(saved[0]).toMatchObject({ id: 'plan-1', weddingDate: '2026-12-01', budget: '800000.00' });
  });

  it('starts without a budget when none was ever set', async () => {
    const { service, saved } = await build([]);
    await service.createPlan(host, { weddingDate: '2026-12-01' });
    expect(saved[0]).toMatchObject({ budget: null });
  });
});
