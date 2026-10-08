import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route as accessible without authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const IS_OPTIONAL_AUTH_KEY = 'optionalAuth';
/**
 * On a `@Public()` route, still identify the caller when they send a bearer
 * token, so the handler can answer an owner differently from a stranger.
 *
 * A missing, expired or otherwise unusable token is not an error here: the
 * request simply proceeds anonymously, exactly as it would without the token.
 * Use it only where the anonymous answer is the safe default.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
