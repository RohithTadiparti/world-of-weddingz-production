import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { StorageService } from '../../platform/storage/storage.service';
import { MediaAccessService } from './media-access.service';
import { MediaUrlInterceptor } from './media-url.interceptor';

const BRIDE = { userId: 'bride', role: UserRole.BRIDE } as AuthUser;
const MINE = 'users/bride/profile/1-a-me.jpg';
const THEIRS = 'users/someone/attachments/1-a-receipt.pdf';
const DELIVERY = 'bookings/b-1/deliveries/1-a-sangeet.jpg';
const signed = (key: string) => `https://bucket/${key}?X-Amz-Signature=sig`;

/** A private store whose signed links are easy to read, and an access rule set to match. */
function setup(isPrivate = true, raw = false) {
  const storage = {
    isPrivate,
    keysIn: (body: unknown) => new Set(JSON.stringify(body).match(/(users|bookings)\/[^"?]+/g) ?? []),
    normaliseDeep: (body: unknown) =>
      JSON.parse(JSON.stringify(body).replace(/https:\/\/bucket\/([^"?]+)\?X-Amz-Signature=sig/g, 'media://$1')),
    signDeep: async (body: unknown, allow: (key: string) => Promise<boolean>) => {
      let text = JSON.stringify(body);
      for (const m of text.match(/media:\/\/[^"]+/g) ?? []) {
        const key = m.slice('media://'.length);
        text = text.replace(`"${m}"`, (await allow(key)) ? `"${signed(key)}"` : 'null');
      }
      return JSON.parse(text);
    },
  } as unknown as StorageService;

  const access = {
    canView: jest.fn(async (viewer: AuthUser | undefined, key: string) => key.startsWith(`users/${viewer?.userId}/`)),
    canReceive: jest.fn(async (_viewer: AuthUser | undefined, key: string) => !key.startsWith('bookings/')),
  } as unknown as MediaAccessService;
  const reflector = { getAllAndOverride: () => raw } as unknown as Reflector;

  const interceptor = new MediaUrlInterceptor(storage, access, reflector);
  const run = async (body: unknown, response: unknown) => {
    const req = { user: BRIDE, body };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    const handled = jest.fn(() => of(response));
    const out = await lastValueFrom(interceptor.intercept(context, { handle: handled }));
    return { out, req, handled };
  };
  return { run, access };
}

describe('MediaUrlInterceptor', () => {
  it('stores a signed link sent back as the reference it was minted from', async () => {
    const { run } = setup();
    const { req } = await run({ photos: [signed(MINE)] }, {});
    expect(req.body).toEqual({ photos: [`media://${MINE}`] });
  });

  it("refuses a body that borrows somebody else's file, before the handler runs", async () => {
    const { run } = setup();
    await expect(run({ evidence: [`media://${THEIRS}`] }, {})).rejects.toThrow(ForbiddenException);
  });

  it('signs every reference on the way out, and nulls a booking file the viewer is not on', async () => {
    const { run } = setup();
    const { out } = await run(undefined, {
      photos: [`media://${MINE}`],
      deliveryEvidence: [`media://${DELIVERY}`],
      legacy: 'http://localhost:8085/api/mock-storage/uploads/u/old.jpg',
    });
    expect(out).toEqual({
      photos: [signed(MINE)],
      deliveryEvidence: [null],
      legacy: 'http://localhost:8085/api/mock-storage/uploads/u/old.jpg',
    });
  });

  it('leaves the references alone on a route that hands them out on purpose', async () => {
    const { run } = setup(true, true);
    const { out } = await run(undefined, { ref: `media://${MINE}` });
    expect(out).toEqual({ ref: `media://${MINE}` });
  });

  it('does nothing at all on the local store', async () => {
    const { run, access } = setup(false);
    const body = { evidence: [`media://${THEIRS}`] };
    const { out, req } = await run(body, { photos: [`media://${MINE}`] });
    expect(req.body).toBe(body);
    expect(out).toEqual({ photos: [`media://${MINE}`] });
    expect(access.canView).not.toHaveBeenCalled();
  });
});
