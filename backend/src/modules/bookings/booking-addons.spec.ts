import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BookingAddonsService } from './booking-addons.service';
import { BookingsService } from './bookings.service';
import { CreateBookingAddonDto, RequoteBookingAddonDto } from './dto/booking-addon.dto';
import { BookingAddon } from './entities/booking-addon.entity';
import { Booking } from './entities/booking.entity';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { BookingAddonStatus, BookingStatus, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const vendor: AuthUser = { userId: 'vendor', email: 'v@example.com', role: UserRole.VENDOR, managedByAgentId: null };

/** Row 17: an add-on only ever carries an amount greater than zero. */
describe('add-on amounts', () => {
  const errorsFor = async (cls: new () => object, body: object) =>
    (await validate(plainToInstance(cls, body))).map((e) => e.property);

  it('refuses a zero or negative proposed price and accepts a positive one or none', async () => {
    expect(await errorsFor(CreateBookingAddonDto, { title: 'Drone', proposedPrice: 0 })).toContain('proposedPrice');
    expect(await errorsFor(CreateBookingAddonDto, { title: 'Drone', proposedPrice: -5 })).toContain('proposedPrice');
    expect(await errorsFor(CreateBookingAddonDto, { title: 'Drone', proposedPrice: 1500 })).toEqual([]);
    expect(await errorsFor(CreateBookingAddonDto, { title: 'Drone' })).toEqual([]);
  });

  it('refuses a zero requote price', async () => {
    expect(await errorsFor(RequoteBookingAddonDto, { vendorPrice: 0 })).toContain('vendorPrice');
    expect(await errorsFor(RequoteBookingAddonDto, { vendorPrice: 18000 })).toEqual([]);
  });

  describe('vendor accepting an add-on', () => {
    let addon: BookingAddon;
    const addons = {
      findOne: jest.fn(async () => addon),
      save: jest.fn(async (a: BookingAddon) => a),
    };
    const bookings = {
      findOne: jest.fn(async () => ({ id: 'b1', status: BookingStatus.CONFIRMED, amount: '10000.00' }) as Booking),
      save: jest.fn(async (b: Booking) => b),
    };
    const bookingsService = {
      assertSeller: jest.fn(async () => undefined),
    } as unknown as BookingsService;
    const service = new BookingAddonsService(
      addons as never,
      bookings as never,
      bookingsService,
      { payments: { currency: 'INR' } } as unknown as AppConfigService,
      { record: jest.fn() } as unknown as OutboxService,
    );

    it('refuses to accept an add-on with no proposed price: it must be requoted', async () => {
      addon = { id: 'a1', bookingId: 'b1', status: BookingAddonStatus.REQUESTED, proposedPrice: null, quantity: 1 } as BookingAddon;
      await expect(service.vendorAccept(vendor, 'a1', {})).rejects.toThrow(/Requote it with yours/);
      expect(addon.status).toBe(BookingAddonStatus.REQUESTED);
    });

    it('refuses a zero price left over from before prices had to be positive', async () => {
      addon = { id: 'a1', bookingId: 'b1', status: BookingAddonStatus.REQUESTED, proposedPrice: '0.00', quantity: 1 } as BookingAddon;
      await expect(service.vendorAccept(vendor, 'a1', {})).rejects.toThrow(/Requote/);
    });
  });
});
