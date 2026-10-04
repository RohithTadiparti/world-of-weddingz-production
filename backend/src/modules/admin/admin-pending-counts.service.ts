import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { VerificationRequest } from '../verification/entities/verification-request.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { Notification } from '../notifications/entities/notification.entity';
import {
  BookingStatus,
  CaseStatus,
  INDIVIDUAL_ROLES,
  PaymentStatus,
  VerificationStatus,
} from '../../common/enums';

export interface AdminPendingCounts {
  users: number;
  agents: number;
  vendors: number;
  verificationOfficers: number;
  weddingPlanners: number;
  bookings: number;
  payments: number;
  verification: number;
  support: number;
  reports: number;
  notifications: number;
}

@Injectable()
export class AdminPendingCountsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AgentProfile) private readonly agents: Repository<AgentProfile>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(VerificationRequest) private readonly verifications: Repository<VerificationRequest>,
    @InjectRepository(SupportCase) private readonly cases: Repository<SupportCase>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
  ) {}

  async getCounts(adminUserId: string): Promise<AdminPendingCounts> {
    const [
      users,
      agents,
      vendors,
      weddingPlanners,
      bookings,
      payments,
      verification,
      support,
      notifications,
    ] = await Promise.all([
      this.users.count({ where: { role: In([...INDIVIDUAL_ROLES]), isVerified: false } }),
      this.agents.count({ where: { isApproved: false } }),
      this.vendors.count({ where: { isApproved: false } }),
      this.planners.count({ where: { isApproved: false } }),
      this.bookings.count({ where: { status: BookingStatus.DISPUTED } }),
      this.payments.count({ where: [
        { status: PaymentStatus.DISPUTED },
        { status: PaymentStatus.PENDING_PAYOUT },
      ] }),
      this.verifications.count({ where: [
        { status: VerificationStatus.SUBMITTED },
        { status: VerificationStatus.ADMIN_REVIEW },
      ] }),
      this.cases.count({ where: [
        { status: CaseStatus.OPEN },
        { status: CaseStatus.TRIAGED },
        { status: CaseStatus.RESOLUTION_SUBMITTED },
        { status: CaseStatus.ADMIN_REVIEW },
      ] }),
      this.notifications.count({ where: { userId: adminUserId, isRead: false } }),
    ]);

    return {
      users,
      agents,
      vendors,
      verificationOfficers: 0,
      weddingPlanners,
      bookings,
      payments,
      verification,
      support,
      reports: 0,
      notifications,
    };
  }
}
