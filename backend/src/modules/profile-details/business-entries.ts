import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BusinessDetailsDto } from './dto/profile-details.dto';

export function businessEntries(business: Record<string, unknown> = {}): Record<string, unknown>[] {
  if (Array.isArray(business.entries)) return business.entries;
  return Object.keys(business).length ? [business] : [];
}

/** Store entries once and project the first for existing single-business clients. */
export function saveBusiness(existing: Record<string, unknown>, incoming: BusinessDetailsDto): Record<string, unknown> {
  const previous = businessEntries(existing);
  const entries = incoming.entries !== undefined
    ? incoming.entries.map((entry) => ({ ...entry, id: entry.id ?? randomUUID() }))
    : [{ ...previous[0], ...incoming, id: previous[0]?.id ?? randomUUID() }, ...previous.slice(1)];
  if (!entries.length || entries.some((entry) => typeof entry.businessName !== 'string' || !entry.businessName.trim())) {
    throw new BadRequestException('At least one business with a business name is required');
  }
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new BadRequestException('Business entry IDs must be unique');
  }
  const { businessName, businessType, businessLocation, businessIncome, id, entries: oldEntries, ...other } = existing;
  return { ...other, ...entries[0], entries };
}
