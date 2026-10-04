import { BadRequestException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { EventsService, WeddingRsvpView } from './events.service';
import { WeddingEvent } from './entities/event.entity';
import { Guest } from './entities/guest.entity';
import { EventInvite } from './entities/event-invite.entity';
import { EventStatus, RsvpStatus } from '../../common/enums';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../platform/mail/mail.service';
import { ModerationService } from '../../platform/moderation/moderation.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';

const HOST = 'host-1';

/** Just enough of TypeORM's `where` for these queries: equality, In, Not, IsNull. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, want]) => {
    const have = row[key];
    if (want instanceof FindOperator) {
      if (want.type === 'in') return (want.value as unknown[]).includes(have);
      if (want.type === 'not') return have !== want.value;
      if (want.type === 'isNull') return have === null || have === undefined;
      throw new Error(`Unsupported operator ${want.type}`);
    }
    return have === want;
  });
}

function table<T extends { id?: string }>(rows: T[], prefix: string) {
  let next = rows.length;
  return {
    rows,
    create: jest.fn((init: Partial<T>) => ({ ...init }) as T),
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((r) => matches(r as Record<string, unknown>, where)),
    ),
    findOne: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((r) => matches(r as Record<string, unknown>, where)) ?? null,
    ),
    save: jest.fn(async (input: T | T[]) => {
      for (const row of Array.isArray(input) ? input : [input]) {
        if (!row.id) row.id = `${prefix}-${++next}`;
        if (!rows.includes(row)) rows.push(row);
      }
      return input;
    }),
  };
}

function setup() {
  const events = table<WeddingEvent>(
    [
      { id: 'haldi', userId: HOST, name: 'Haldi', status: EventStatus.UPCOMING, venue: 'Home', venueAddress: '12 Family Lane' },
      { id: 'reception', userId: HOST, name: 'Reception', status: EventStatus.UPCOMING, venue: 'Grand Hall' },
      { id: 'mehendi', userId: HOST, name: 'Mehendi', status: EventStatus.CANCELLED },
      { id: 'elsewhere', userId: 'other-host', name: 'Not theirs', status: EventStatus.UPCOMING },
    ] as unknown as WeddingEvent[],
    'event',
  );
  const guests = table<Guest>(
    [{ id: 'g1', userId: HOST, name: 'Ravi', contact: '', partySize: 4, rsvpStatus: null } as unknown as Guest],
    'guest',
  );
  const invites = table<EventInvite>([], 'invite');
  const repo = (x: unknown) => x as never;

  const service = new EventsService(
    repo({}),
    repo(events),
    repo(guests),
    repo(invites),
    repo({ findOne: jest.fn(async () => null), create: jest.fn((x) => x), save: jest.fn(async (x) => x) }),
    repo({ find: jest.fn(async () => []), findOne: jest.fn(async () => null) }),
    repo({}),
    repo({}),
    repo({}),
    repo({}),
    repo({}),
    repo({}),
    repo({}),
    { auth: { rsvpTokenTtlDays: 30 } } as unknown as AppConfigService,
    { sendRsvpInvitation: jest.fn() } as unknown as MailService,
    {} as ModerationService,
    {} as NotificationsService,
    { fixedPartnerUserId: jest.fn(async () => null) } as unknown as MatchmakingService,
  );
  const inviteOn = (eventId: string) => invites.rows.find((i) => i.eventId === eventId);
  return { service, invites, inviteOn };
}

describe('EventsService wedding invitation', () => {
  describe('which events it covers', () => {
    it('covers only the events the guest is already invited to', async () => {
      const { service, invites } = setup();
      invites.rows.push({ id: 'i1', eventId: 'reception', guestId: 'g1', status: RsvpStatus.INVITED } as EventInvite);

      const { rsvpToken } = await service.inviteToWedding(HOST, 'g1');
      const view = (await service.previewByToken(rsvpToken)) as WeddingRsvpView;

      expect(view.events.map((e) => e.name)).toEqual(['Reception']);
      expect(JSON.stringify(view)).not.toContain('12 Family Lane');
      expect(invites.rows.map((i) => i.eventId)).toEqual(['reception']);
    });

    it('covers the events the host chooses, and invites the guest to them', async () => {
      const { service, inviteOn } = setup();
      const { rsvpToken } = await service.inviteToWedding(HOST, 'g1', ['haldi', 'reception']);
      const view = (await service.previewByToken(rsvpToken)) as WeddingRsvpView;

      expect(view.events.map((e) => e.name).sort()).toEqual(['Haldi', 'Reception']);
      expect(inviteOn('haldi')?.status).toBe(RsvpStatus.INVITED);
      expect(inviteOn('mehendi')).toBeUndefined();
    });

    it('refuses an event that is cancelled or not the host\'s', async () => {
      const { service } = setup();
      await expect(service.inviteToWedding(HOST, 'g1', ['mehendi'])).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.inviteToWedding(HOST, 'g1', ['elsewhere'])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('asks for events when the guest is invited to none', async () => {
      const { service } = setup();
      await expect(service.inviteToWedding(HOST, 'g1')).rejects.toThrow('Choose the events this invitation covers');
    });
  });

  describe('keeping per-event answers', () => {
    it('does not overwrite an event answered on its own with a later wedding reply', async () => {
      const { service, inviteOn } = setup();
      const { rsvpToken } = await service.inviteToWedding(HOST, 'g1', ['haldi', 'reception']);

      // 1. The guest answers the wedding invitation.
      await service.respondByToken(rsvpToken, { status: RsvpStatus.ATTENDING, attendingCount: 4 });
      expect(inviteOn('haldi')?.status).toBe(RsvpStatus.ATTENDING);
      expect(inviteOn('reception')?.status).toBe(RsvpStatus.ATTENDING);

      // 2. Later they decline the Haldi on its own (recorded by the host).
      await service.updateRsvp(HOST, inviteOn('haldi')!.id, { status: RsvpStatus.DECLINED });

      // 3. The host sends the invitation again and records a new wedding reply.
      await service.inviteToWedding(HOST, 'g1');
      await service.respondForGuest(HOST, 'g1', { status: RsvpStatus.ATTENDING, attendingCount: 2 });

      expect(inviteOn('haldi')).toMatchObject({ status: RsvpStatus.DECLINED, answeredIndividually: true });
      expect(inviteOn('reception')).toMatchObject({ status: RsvpStatus.ATTENDING, attendingCount: 2 });
    });
  });
});
