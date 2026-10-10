import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { VendorService } from './entities/vendor-service.entity';
import { ServiceOffering } from './entities/service-offering.entity';
import { ServiceDefinition } from './entities/service-definition.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { CatalogService } from './catalog.service';
import { serviceNamesByIds } from './service-names';
import { UpsertOfferingDto, UpsertVendorServiceDto } from './dto/catalog.dto';
import { describeForm, validateAttributes } from './attribute-validation';
import { AttributeScope, BusinessStatus, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AppConfigService } from '../../config/app-config.service';
import { QUANTITY_MODELS, QUOTE_ONLY, requirementsRequired } from './booking-request-rules';
import { normaliseOfferingText, offeringProblems } from './offering-rules';

/**
 * The vendor's half of the catalog: which services they offer, how they have
 * answered each one's questions, and what they charge for them.
 *
 * Everything a vendor writes here is checked against the definition the
 * administrator configured — the attribute answers by the validator, the
 * pricing model against `allowedPricingModels`, packages against
 * `packagesAllowed`. That is the whole trade the catalog makes: configuration
 * is free to change, and the validator is what keeps it from becoming a mess.
 */
@Injectable()
export class VendorServicesService {
  constructor(
    @InjectRepository(VendorService)
    private readonly services: Repository<VendorService>,
    @InjectRepository(ServiceOffering)
    private readonly offerings: Repository<ServiceOffering>,
    @InjectRepository(ServiceDefinition)
    private readonly definitions: Repository<ServiceDefinition>,
    @InjectRepository(ServiceCategory)
    private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(Vendor)
    private readonly vendors: Repository<Vendor>,
    private readonly catalog: CatalogService,
    private readonly cfg: AppConfigService,
  ) {}

  // ------------------------------------------------------------- ownership

  private async assertOwner(actor: AuthUser, vendorId: string): Promise<Vendor> {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Business not found');
    if (actor.role !== UserRole.ADMIN && vendor.ownerUserId !== actor.userId) {
      throw new ForbiddenException('That business is not yours');
    }
    return vendor;
  }

  /**
   * Whether this caller owns the business, without refusing if they do not.
   *
   * The listing read is open to every signed-in account — a buyer choosing a
   * service and a vendor editing one look at the same rows — so the answer
   * decides how much of it comes back rather than whether anything does.
   */
  async ownsVendor(actor: AuthUser, vendorId: string): Promise<boolean> {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Business not found');
    return actor.role === UserRole.ADMIN || vendor.ownerUserId === actor.userId;
  }

  /**
   * Loads a vendor service and proves it belongs to the caller.
   *
   * Offerings are addressed by their own id, so without this an offering id
   * from one vendor could be edited under another vendor's path — the same
   * class of hole the booking routes had.
   */
  private async ownedService(actor: AuthUser, vendorId: string, id: string): Promise<VendorService> {
    await this.assertOwner(actor, vendorId);
    const service = await this.services.findOne({ where: { id, vendorId } });
    if (!service) throw new NotFoundException('That service is not on this business');
    return service;
  }

  // -------------------------------------------------------- vendor services

  /**
   * Everything this business sells, each expanded with its definition, its
   * category, the form its buyers will be asked, and its live offerings.
   *
   * Returned whole because every caller needs all of it: the vendor console to
   * render the editor, the directory to render the listing, and the booking
   * form to know what to ask.
   */
  async listForVendor(vendorId: string, activeOnly = false) {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Business not found');
    const services = await this.services.find({
      where: activeOnly ? { vendorId, active: true } : { vendorId },
      order: { createdAt: 'ASC' },
    });
    if (services.length === 0) return [];

    const definitionIds = services.map((s) => s.definitionId);
    const [definitions, attributesByDefinition, offerings] = await Promise.all([
      this.definitions.find({ where: { id: In(definitionIds) } }),
      this.catalog.attributesForMany(definitionIds),
      this.offerings.find({
        where: { vendorServiceId: In(services.map((s) => s.id)) },
        order: { sortOrder: 'ASC', name: 'ASC' },
      }),
    ]);

    const categories = await this.categories.find({
      where: { id: In(Array.from(new Set(definitions.map((d) => d.categoryId)))) },
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const definitionById = new Map(definitions.map((d) => [d.id, d]));

    const expanded = services.map((service) => {
      const definition = definitionById.get(service.definitionId) ?? null;
      const category = definition ? (categoryById.get(definition.categoryId) ?? null) : null;
      const attributes = attributesByDefinition.get(service.definitionId) ?? [];
      const mine = offerings.filter((o) => o.vendorServiceId === service.id);
      /*
       * A service whose category the business no longer lists is kept, not
       * hidden: the vendor still has to be able to see it, switch it off or
       * remove it, and an administrator or officer reviewing the business has
       * to see everything on it. It is taken off sale instead, so what the
       * public can book always matches what the vendor can see.
       */
      const outsideSelectedCategories = !this.inSelectedCategories(vendor, category?.slug ?? null);

      const onSale =
        service.active &&
        !outsideSelectedCategories &&
        definition?.active !== false &&
        category?.active !== false;

      /*
       * The public catalogue is a deliberate projection, not a serialised
       * database entity. In particular, pending prices are an internal review
       * workflow and capacity is operational information, neither of which
       * belongs on a customer-facing listing.
       */
      const publicRow = {
        id: service.id,
        displayName: service.displayName,
        description: service.description,
        attributes: service.attributes,
        definition: definition
          ? {
              id: definition.id,
              slug: definition.slug,
              name: definition.name,
              description: definition.description,
            }
          : null,
        category: category ? { slug: category.slug, name: category.name } : null,
        serviceForm: describeForm(attributes, AttributeScope.SERVICE),
        // Kept as a harmless false marker so callers can use the same display
        // shape for owner and public reads without exposing the owner's
        // category-selection state.
        outsideSelectedCategories: false,
        offerings: mine
          .filter((offering) => offering.active)
          .map((offering) => ({
            id: offering.id,
            name: offering.name,
            description: offering.description,
            pricingModel: offering.pricingModel,
            price: offering.price,
            currency: offering.currency,
            unitLabel: offering.unitLabel,
            minQuantity: offering.minQuantity,
            maxQuantity: offering.maxQuantity,
            isPackage: offering.isPackage,
            inclusions: offering.inclusions,
          })),
      };

      const ownerRow = {
        ...service,
        definition,
        category,
        serviceForm: describeForm(attributes, AttributeScope.SERVICE),
        bookingForm: describeForm(attributes, AttributeScope.BOOKING),
        offerings: mine,
        outsideSelectedCategories,
        /**
         * Whether a buyer could actually book this today. A service with no
         * live offering is a description with no price, and the request form
         * has nothing to submit — so say so here rather than letting the
         * buyer find out at the end.
         */
        bookable: onSale && mine.some((o) => o.active),
      };

      return activeOnly
        ? { ...publicRow, bookable: onSale && publicRow.offerings.length > 0 }
        : ownerRow;
    });

    // The public read shows only what can be booked from it.
    return activeOnly
      ? expanded.filter((s) => s.bookable)
      : expanded;
  }

  /**
   * Whether a service in this category belongs to the categories the business
   * lists.
   *
   * A business with no categories at all is one migrated from the single
   * legacy category (listed as "Other" or a value the catalogue no longer
   * has). It has not chosen yet, so nothing it already sells is treated as
   * outside its choice.
   */
  private inSelectedCategories(vendor: Vendor, categorySlug: string | null): boolean {
    const selected = vendor.categories ?? [];
    if (selected.length === 0) return true;
    return categorySlug !== null && selected.includes(categorySlug);
  }

  async addService(actor: AuthUser, vendorId: string, dto: UpsertVendorServiceDto) {
    const vendor = await this.assertOwner(actor, vendorId);
    // A rejected listing is locked — no new services on a business that has been
    // turned down in verification (EZ1-I119).
    if (actor.role !== UserRole.ADMIN && vendor.status === BusinessStatus.REJECTED) {
      throw new ForbiddenException(
        'This listing was rejected in verification and is locked. Raise a support case if you think this is a mistake.',
      );
    }

    const definition = await this.catalog.getDefinition(dto.definitionId);
    await this.assertSelectedCategory(vendor, definition.categoryId);
    if (!definition.active) {
      throw new BadRequestException('That service is no longer offered in the catalog');
    }

    const existing = await this.services.findOne({
      where: { vendorId, definitionId: definition.id },
    });
    if (existing) {
      throw new BadRequestException(
        `You already offer ${definition.name}. Edit it rather than adding it twice.`,
      );
    }

    const attributes = await this.catalog.attributesFor(definition.id);
    const validated = validateAttributes(attributes, AttributeScope.SERVICE, dto.attributes);

    return this.services.save(
      this.services.create({
        vendorId,
        definitionId: definition.id,
        displayName: dto.displayName ?? null,
        description: dto.description ?? null,
        attributes: validated,
        // Capacity is set on each published window now; the definition's
        // default still seeds windows that do not name one.
        concurrentCapacity: definition.defaultCapacity,
        active: dto.active ?? true,
      }),
    );
  }

  async updateService(
    actor: AuthUser,
    vendorId: string,
    id: string,
    dto: UpsertVendorServiceDto,
  ): Promise<VendorService> {
    const service = await this.ownedService(actor, vendorId, id);

    // Switching a service off is always allowed, including one whose category
    // the business has since dropped: that is exactly the service the vendor
    // needs to be able to take down. Anything more than that is new selling
    // under the service, so it has to sit in a category the business lists.
    const onlyDeactivating =
      dto.active === false &&
      dto.attributes === undefined &&
      dto.displayName === undefined &&
      dto.description === undefined;
    if (!onlyDeactivating) {
      const vendor = await this.assertOwner(actor, vendorId);
      const definition = await this.catalog.getDefinition(service.definitionId);
      await this.assertSelectedCategory(vendor, definition.categoryId);
    }

    // The definition is what all the validation hangs off, so it is not
    // something an update may quietly swap. Changing it means a new service.
    if (dto.definitionId && dto.definitionId !== service.definitionId) {
      throw new BadRequestException(
        'A service cannot be changed into a different one. Add the new service instead.',
      );
    }

    if (dto.attributes !== undefined) {
      const attributes = await this.catalog.attributesFor(service.definitionId);
      service.attributes = validateAttributes(attributes, AttributeScope.SERVICE, dto.attributes);
    }

    if (dto.displayName !== undefined) service.displayName = dto.displayName || null;
    if (dto.description !== undefined) service.description = dto.description || null;
    if (dto.active !== undefined) service.active = dto.active;

    return this.services.save(service);
  }

  private async assertSelectedCategory(vendor: Vendor, categoryId: string): Promise<void> {
    const category = await this.categories.findOne({ where: { id: categoryId } });
    if (!category || !this.inSelectedCategories(vendor, category.slug)) {
      throw new BadRequestException(
        'This service is outside the categories your business lists. Add the category to your ' +
          'business, or switch the service off.',
      );
    }
  }

  /**
   * Refuses a buyer path into a service whose category the business no longer
   * lists, so the public read and what can actually be booked agree.
   */
  private async assertOnSale(service: VendorService, categoryId: string): Promise<void> {
    const vendor = await this.vendors.findOne({ where: { id: service.vendorId } });
    if (!vendor) throw new NotFoundException('That service is not available');
    const slug = await this.categorySlugOf(categoryId);
    if (!this.inSelectedCategories(vendor, slug)) {
      throw new BadRequestException('That service is not currently offered');
    }
  }

  /**
   * Takes a service off the business.
   *
   * Refused while any offering under it is still live, because a booking in
   * flight refers to the offering it was priced from. Deactivating is the
   * usual answer and is what the message points at.
   */
  async removeService(actor: AuthUser, vendorId: string, id: string): Promise<{ success: true }> {
    const service = await this.ownedService(actor, vendorId, id);

    const live = await this.offerings.count({ where: { vendorServiceId: id, active: true } });
    if (live > 0) {
      throw new BadRequestException(
        'Retire the prices under this service first, or switch the service off instead of removing it.',
      );
    }

    await this.offerings.delete({ vendorServiceId: id });
    await this.services.remove(service);
    return { success: true };
  }

  // -------------------------------------------------------------- offerings

  async addOffering(
    actor: AuthUser,
    vendorId: string,
    serviceId: string,
    dto: UpsertOfferingDto,
  ): Promise<ServiceOffering> {
    const service = await this.ownedService(actor, vendorId, serviceId);
    const definition = await this.catalog.getDefinition(service.definitionId);
    this.assertPricingAllowed(definition, dto);
    const text = normaliseOfferingText(dto);

    return this.offerings.save(
      this.offerings.create({
        vendorServiceId: service.id,
        name: text.name,
        description: text.description,
        pricingModel: dto.pricingModel,
        price: QUOTE_ONLY.includes(dto.pricingModel) ? null : (dto.price ?? null),
        currency: dto.currency ?? 'INR',
        unitLabel: dto.unitLabel ?? null,
        minQuantity: dto.minQuantity ?? null,
        maxQuantity: dto.maxQuantity ?? null,
        isPackage: dto.isPackage ?? false,
        inclusions: dto.inclusions ?? [],
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
  }

  async updateOffering(
    actor: AuthUser,
    vendorId: string,
    serviceId: string,
    offeringId: string,
    dto: UpsertOfferingDto,
  ): Promise<ServiceOffering> {
    const service = await this.ownedService(actor, vendorId, serviceId);
    const offering = await this.offerings.findOne({
      where: { id: offeringId, vendorServiceId: service.id },
    });
    if (!offering) throw new NotFoundException('That price is not on this service');

    const definition = await this.catalog.getDefinition(service.definitionId);
    this.assertPricingAllowed(definition, dto);
    const text = normaliseOfferingText(dto);

    const proposed = QUOTE_ONLY.includes(dto.pricingModel) ? null : (dto.price ?? null);
    const held = await this.needsReview(vendorId, offering.price, proposed);

    Object.assign(offering, {
      name: text.name,
      description: text.description,
      pricingModel: dto.pricingModel,
      // A change big enough to need a look is parked rather than applied. The
      // old price keeps selling in the meantime: taking the shop off sale
      // while somebody reviews it punishes the vendor for the platform's
      // caution.
      price: held ? offering.price : proposed,
      pendingPrice: held ? proposed : null,
      pendingSince: held ? new Date() : null,
      currency: dto.currency ?? offering.currency,
      unitLabel: dto.unitLabel ?? null,
      minQuantity: dto.minQuantity ?? null,
      maxQuantity: dto.maxQuantity ?? null,
      isPackage: dto.isPackage ?? false,
      inclusions: dto.inclusions ?? [],
      active: dto.active ?? offering.active,
      sortOrder: dto.sortOrder ?? offering.sortOrder,
    });
    return this.offerings.save(offering);
  }

  /**
   * Whether a price change is big enough that somebody should look at it.
   *
   * Off unless configured, and only ever on a business that is actually
   * trading: a listing still being set up has no customers to protect, and
   * holding its first prices for review would put a queue in front of a vendor
   * filling in a form.
   *
   * A price appearing where there was none, or disappearing, is not a change
   * of degree and is left alone — those are the vendor deciding what kind of
   * thing they sell, which is theirs to decide.
   */
  private async needsReview(
    vendorId: string,
    current: string | null,
    proposed: string | null,
  ): Promise<boolean> {
    const threshold = this.cfg.features.catalogReviewThresholdPercent;
    if (!threshold || current === null || proposed === null) return false;

    const was = Number(current);
    const now = Number(proposed);
    if (!was || was === now) return false;

    const movement = (Math.abs(now - was) / was) * 100;
    if (movement < threshold) return false;

    const business = await this.vendors.findOne({ where: { id: vendorId } });
    return business?.status === BusinessStatus.LIVE;
  }

  /** Price changes waiting on somebody, across the platform. */
  async pendingPriceChanges(): Promise<
    {
      offeringId: string;
      vendorId: string;
      /** The business asking for the change. */
      vendorName: string | null;
      /** The service the offering is priced under. */
      serviceName: string | null;
      name: string;
      from: string | null;
      to: string | null;
      since: Date | null;
    }[]
  > {
    const offerings = await this.offerings.find({
      where: { pendingPrice: Not(IsNull()) },
      order: { pendingSince: 'ASC' },
    });
    if (offerings.length === 0) return [];

    const serviceIds = [...new Set(offerings.map((o) => o.vendorServiceId))];
    const [services, serviceNames] = await Promise.all([
      this.services.find({ where: { id: In(serviceIds) } }),
      serviceNamesByIds(this.services, serviceIds),
    ]);
    const vendorOf = new Map(services.map((s) => [s.id, s.vendorId]));
    // An administrator deciding on "Gold package: 40,000 to 55,000" needs to
    // know whose package, under which service.
    const vendorIds = [...new Set(services.map((s) => s.vendorId))];
    const vendors = vendorIds.length
      ? await this.vendors.find({ where: { id: In(vendorIds) } })
      : [];
    const vendorName = new Map(vendors.map((v) => [v.id, v.name]));

    return offerings.map((o) => ({
      offeringId: o.id,
      vendorId: vendorOf.get(o.vendorServiceId) ?? '',
      vendorName: vendorName.get(vendorOf.get(o.vendorServiceId) ?? '') ?? null,
      serviceName: serviceNames.get(o.vendorServiceId) ?? null,
      name: o.name,
      from: o.price,
      to: o.pendingPrice,
      since: o.pendingSince,
    }));
  }

  /**
   * An administrator answers a held price change.
   *
   * Approving applies it; refusing discards it and leaves the price where it
   * was. Either way the hold is cleared, so a vendor is never left with a
   * proposal nobody will ever answer sitting invisibly on their catalogue.
   */
  async decidePriceChange(offeringId: string, approve: boolean): Promise<ServiceOffering> {
    const offering = await this.offerings.findOne({ where: { id: offeringId } });
    if (!offering) throw new NotFoundException('That price does not exist');
    if (offering.pendingPrice === null) {
      throw new BadRequestException('There is no price change waiting on that offering');
    }

    if (approve) offering.price = offering.pendingPrice;
    offering.pendingPrice = null;
    offering.pendingSince = null;
    return this.offerings.save(offering);
  }

  async removeOffering(
    actor: AuthUser,
    vendorId: string,
    serviceId: string,
    offeringId: string,
  ): Promise<{ success: true }> {
    const service = await this.ownedService(actor, vendorId, serviceId);
    const offering = await this.offerings.findOne({
      where: { id: offeringId, vendorServiceId: service.id },
    });
    if (!offering) throw new NotFoundException('That price is not on this service');

    await this.offerings.remove(offering);
    return { success: true };
  }

  /**
   * The rules the administrator's configuration imposes on a price.
   *
   * All four are the same kind of check: the catalog said what this service
   * may do, and the vendor is being held to it.
   */
  private assertPricingAllowed(definition: ServiceDefinition, dto: UpsertOfferingDto): void {
    if (!definition.allowedPricingModels.includes(dto.pricingModel)) {
      throw new BadRequestException(
        `${definition.name} cannot be priced ${dto.pricingModel.replace(/_/g, ' ')}. ` +
          `Allowed: ${definition.allowedPricingModels.join(', ')}.`,
      );
    }

    if (dto.isPackage && !definition.packagesAllowed) {
      throw new BadRequestException(`${definition.name} is not sold as a package`);
    }

    // Pricing name, amount and description: a name that is not blank, an
    // amount above zero wherever the model publishes one, and a description a
    // buyer can actually read, 50 to 500 characters. One message per field, so
    // a form that skipped its own checks still hears everything at once.
    const problems = offeringProblems(dto);
    const messages = [problems.name, problems.price, problems.description].filter(Boolean);
    if (messages.length > 0) {
      throw new BadRequestException(messages.join('. '));
    }

    if (
      dto.minQuantity !== undefined &&
      dto.maxQuantity !== undefined &&
      dto.minQuantity > dto.maxQuantity
    ) {
      throw new BadRequestException('The minimum quantity is above the maximum');
    }
    if (
      (dto.minQuantity !== undefined || dto.maxQuantity !== undefined) &&
      !QUANTITY_MODELS.includes(dto.pricingModel)
    ) {
      throw new BadRequestException(
        'Minimum and maximum quantity only mean something on a per-unit price',
      );
    }
  }

  // ------------------------------------------------------------ buyer side

  /**
   * What a buyer needs to make a request against one service: the questions to
   * ask them, and the prices they can choose from.
   *
   * This is the route that replaces a hand-written booking form per vendor
   * type. The form is generated from the definition the vendor picked.
   */
  async bookingContext(vendorServiceId: string) {
    const service = await this.services.findOne({ where: { id: vendorServiceId } });
    if (!service) throw new NotFoundException('That service is not available');
    if (!service.active) throw new BadRequestException('That service is not currently offered');

    const [definition, attributes, offerings, vendor] = await Promise.all([
      this.catalog.getDefinition(service.definitionId),
      this.catalog.attributesFor(service.definitionId),
      this.offerings.find({
        where: { vendorServiceId, active: true },
        order: { sortOrder: 'ASC', name: 'ASC' },
      }),
      this.vendors.findOne({ where: { id: service.vendorId } }),
    ]);

    await this.assertOnSale(service, definition.categoryId);
    if (offerings.length === 0) {
      throw new BadRequestException('This service has no published prices yet');
    }

    const bookingForm = describeForm(attributes, AttributeScope.BOOKING);
    const categorySlug = await this.categorySlugOf(definition.categoryId);
    return {
      vendorService: service,
      vendorId: service.vendorId,
      vendorName: vendor?.name ?? null,
      definition,
      categorySlug,
      availabilityModel: definition.availabilityModel,
      bookingForm,
      offerings,
      // Said by the server so the form asks exactly what the request is checked
      // against: a mehendi artist does not need "What do you need?" answered.
      requirementsRequired: requirementsRequired([categorySlug], bookingForm.length > 0),
    };
  }

  private async categorySlugOf(categoryId: string): Promise<string | null> {
    const category = await this.categories.findOne({ where: { id: categoryId } });
    return category?.slug ?? null;
  }

  /**
   * Validates a buyer's answers to a service's booking form.
   *
   * Lives here rather than in the bookings module so that the rules a form was
   * generated from and the rules its submission is checked against are the
   * same code. The bookings module calls this and stores what comes back.
   */
  async validateBookingAnswers(
    vendorServiceId: string,
    answers: Record<string, unknown> | undefined,
  ): Promise<{
    service: VendorService;
    answers: Record<string, unknown>;
    requirementsRequired: boolean;
  }> {
    const service = await this.services.findOne({ where: { id: vendorServiceId } });
    if (!service) throw new NotFoundException('That service is not available');
    if (!service.active) throw new BadRequestException('That service is not currently offered');

    const [attributes, definition] = await Promise.all([
      this.catalog.attributesFor(service.definitionId),
      this.catalog.getDefinition(service.definitionId),
    ]);
    await this.assertOnSale(service, definition.categoryId);
    const hasFormFields = attributes.some((a) => a.scope === AttributeScope.BOOKING);
    return {
      service,
      answers: validateAttributes(attributes, AttributeScope.BOOKING, answers),
      requirementsRequired: requirementsRequired(
        [await this.categorySlugOf(definition.categoryId)],
        hasFormFields,
      ),
    };
  }

  async findOffering(id: string): Promise<ServiceOffering | null> {
    return this.offerings.findOne({ where: { id } });
  }

  /** Offering id → name, for decorating booking rows in one query (EZ1-I33). */
  async offeringNamesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.offerings.find({ where: { id: In(ids) } });
    return new Map(rows.map((o) => [o.id, o.name]));
  }

  async findService(id: string): Promise<VendorService | null> {
    return this.services.findOne({ where: { id } });
  }

  /** How many services this business has switched on, for the publish-a-window rule. */
  async countActiveServices(vendorId: string): Promise<number> {
    return this.services.count({ where: { vendorId, active: true } });
  }
}
