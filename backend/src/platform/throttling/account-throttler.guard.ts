import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

export const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests. Please wait a moment and try again.';

/**
 * Rate limits by account when the caller is authenticated, and by IP otherwise.
 *
 * IP-only limiting let one account spread abuse across many addresses, and
 * conversely put every user behind a corporate NAT into the same bucket. The
 * signed-in user id is the more meaningful key when we have it.
 */
@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { userId?: string } | undefined;
    if (user?.userId) return `user:${user.userId}`;

    // Behind nginx/an ELB, req.ip is the proxy unless trust proxy is set (it is,
    // see main.ts), so this is the real client address.
    const ip = (req.ip as string) ?? 'unknown';
    return `ip:${ip}`;
  }

  /**
   * The library throws its own exception with a bare string body
   * ("ThrottlerException: Too Many Requests"), which the exception filter can
   * only wrap as `{ message }`. Throwing the shape every other HTTP error has
   * keeps 429s in the standard envelope, with copy fit to show a person.
   * Retry-After is already on the response by the time this runs.
   */
  protected async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      {
        message: TOO_MANY_REQUESTS_MESSAGE,
        error: 'Too Many Requests',
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
