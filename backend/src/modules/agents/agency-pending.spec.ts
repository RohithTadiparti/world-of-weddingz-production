import { IsNull, Not } from 'typeorm';
import { AgencyService, missingAgencyDetails } from './agency.service';
import { PENDING_AGENCY, REJECTED_AGENCY } from './agency-status';
import { AdminPendingCountsService } from '../admin/admin-pending-counts.service';

function build(agencies: unknown) {
  return new AgencyService(
    agencies as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('AgencyService.listPending', () => {
  it('lists every agency waiting on an administrator, incomplete ones included, and flags what is missing', async () => {
    const complete = {
      id: 'a1',
      agencyName: 'Complete Agency',
      contactPhone: '+917989014590',
      address: 'Road 1',
      startDate: '2022-02-09',
      isApproved: false,
      rejectionReason: null,
    };
    const bare = {
      id: 'a2',
      agencyName: 'QA Second Agency',
      contactPhone: null,
      address: null,
      startDate: null,
      isApproved: false,
      rejectionReason: null,
    };
    const agencies = { find: jest.fn().mockResolvedValue([complete, bare]) };

    const rows = await build(agencies).listPending();

    // Nothing about the optional details, and rejected agencies left out.
    expect(agencies.find).toHaveBeenCalledWith({
      where: { isApproved: false, rejectionReason: IsNull() },
      order: { createdAt: 'ASC' },
    });
    expect(rows.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(rows[0].missingDetails).toEqual([]);
    expect(rows[1].missingDetails).toEqual(['contactPhone', 'address', 'startDate']);
  });

  it('masks the contact phone without counting it as missing (ISS-11)', async () => {
    const agencies = {
      find: jest.fn().mockResolvedValue([
        { id: 'a1', contactPhone: '+917989014590', address: 'Road 1', startDate: '2022-02-09' },
      ]),
    };
    const [row] = await build(agencies).listPending();
    expect(row.contactPhone).toBe('********4590');
    expect(row.missingDetails).toEqual([]);
  });

  it('treats a blank string as missing', () => {
    expect(missingAgencyDetails({ contactPhone: '  ', address: 'x', startDate: null })).toEqual([
      'contactPhone',
      'startDate',
    ]);
  });
});

describe('AgencyService.listRejected', () => {
  it('lists refused agencies apart from the pending ones, newest refusal first', async () => {
    const agencies = {
      find: jest.fn().mockResolvedValue([
        { id: 'r1', contactPhone: '9876543210', isApproved: false, rejectionReason: 'Address not found' },
      ]),
    };
    const rows = await build(agencies).listRejected();
    expect(agencies.find).toHaveBeenCalledWith({
      where: { isApproved: false, rejectionReason: Not(IsNull()) },
      order: { updatedAt: 'DESC' },
    });
    expect(rows[0]).toMatchObject({ id: 'r1', rejectionReason: 'Address not found' });
    expect(rows[0].contactPhone).toBe('******3210');
  });
});

describe('pending agencies, one definition (ISS-10)', () => {
  it('splits unapproved agencies by whether they carry a rejection', () => {
    expect(PENDING_AGENCY).toEqual({ isApproved: false, rejectionReason: IsNull() });
    expect(REJECTED_AGENCY).toEqual({ isApproved: false, rejectionReason: Not(IsNull()) });
  });

  it('counts the approvals badge with the same filter the pending list uses', async () => {
    const repo = (count = 0) => ({ count: jest.fn().mockResolvedValue(count) });
    const agents = repo(2);
    const service = new AdminPendingCountsService(
      repo() as never, // users
      agents as never,
      repo() as never, // vendors
      repo() as never, // planners
      repo() as never, // bookings
      repo() as never, // payments
      repo() as never, // verifications
      repo() as never, // cases
      repo() as never, // notifications
    );

    const counts = await service.getCounts('admin-1');

    expect(agents.count).toHaveBeenCalledWith({ where: PENDING_AGENCY });
    expect(counts.agents).toBe(2);
  });
});
