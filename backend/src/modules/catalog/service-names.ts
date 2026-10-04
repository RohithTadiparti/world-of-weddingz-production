import { Repository } from 'typeorm';
import { VendorService } from './entities/vendor-service.entity';

/**
 * A vendor service's name as couples see it: the vendor's own wording when
 * they gave one, the catalogue's otherwise.
 *
 * `displayName` is only an override and is empty unless the vendor typed one,
 * so reading it alone put "—" where the service belongs on every booking
 * against an ordinary catalogue service (EZ1-I264).
 */
export async function serviceNamesByIds(
  repo: Repository<VendorService>,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const rows = await repo
    .createQueryBuilder('s')
    .leftJoin('service_definitions', 'd', 'd.id = s."definitionId"')
    .select('s.id', 'id')
    .addSelect(`COALESCE(NULLIF(s."displayName", ''), d.name)`, 'name')
    .where('s.id IN (:...ids)', { ids: unique })
    .getRawMany<{ id: string; name: string | null }>();

  return new Map(
    rows.filter((row) => row.name).map((row) => [row.id, row.name as string]),
  );
}
