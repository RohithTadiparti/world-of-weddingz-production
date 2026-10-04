import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MediaService } from './media.service';
import {
  AddMediaItemDto,
  CompleteUploadDto,
  CreateAlbumDto,
  PresignAttachmentDto,
  PresignBiodataDto,
  PresignBookingFileDto,
  PresignDto,
  SignMediaDto,
} from './dto/media.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RawMediaRefs } from './media-url.interceptor';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

/**
 * The origin a request reached, as its client sees it.
 *
 * Used only to build a mock-storage URL the same device can reach (see
 * LocalStorageDriver.base). Behind the web proxy the Host header carries
 * the port, and X-Forwarded-* wins where a further proxy sets it. Anything that
 * is not a plain host[:port] over http or https is ignored rather than put into
 * a URL.
 */
function requestOrigin(req: Request): string | undefined {
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host);
  const proto = first(req.headers['x-forwarded-proto']) || req.protocol;
  if (!host || !/^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:\d{1,5})?$/.test(host)) return undefined;
  if (proto !== 'http' && proto !== 'https') return undefined;
  return `${proto}://${host}`;
}

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @Post('albums')
  createAlbum(@CurrentUser('userId') userId: string, @Body() dto: CreateAlbumDto) {
    return this.media.createAlbum(userId, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @Get('albums')
  listAlbums(@CurrentUser('userId') userId: string) {
    return this.media.listAlbums(userId);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @Post('albums/:id/presign')
  @RawMediaRefs()
  presign(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PresignDto,
    @Req() req: Request,
  ) {
    return this.media.presignAlbumPhoto(actor, id, dto, requestOrigin(req));
  }

  /**
   * An upload slot for a profile photograph.
   *
   * Separate from the album route because the two are different permissions and
   * different owners: albums belong to the couple and need `MEDIA_MANAGE_OWN`,
   * which an agent does not hold — yet an agent sets profile photographs for
   * every client on their books.
   * Without this the profile editors could only take a URL, so an agent had to
   * upload somewhere else first and paste a link back in.
   */
  @ApiBearerAuth()
  @RequirePermissions(Permission.PROFILE_MANAGE_OWN)
  @ApiOperation({ summary: 'Get an upload URL for a profile photograph' })
  @Post('profile-photo/presign')
  @RawMediaRefs()
  presignProfilePhoto(
    @CurrentUser() actor: AuthUser,
    @Body() dto: PresignDto,
    @Req() req: Request,
  ) {
    return this.media.presignProfilePhoto(actor, dto, requestOrigin(req));
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PROFILE_MANAGE_OWN)
  @ApiOperation({ summary: 'Get an upload URL for a biodata document' })
  @Post('biodata/presign')
  @RawMediaRefs()
  presignBiodata(
    @CurrentUser() actor: AuthUser,
    @Body() dto: PresignBiodataDto,
    @Req() req: Request,
  ) {
    return this.media.presignUpload(
      actor,
      { owner: 'users', id: actor.userId, area: 'biodata' },
      dto,
      requestOrigin(req),
    );
  }

  /**
   * An upload slot for something a person is attaching as proof.
   *
   * Gated on `CASE_RAISE` rather than on a media permission: everybody who can
   * raise a complaint needs to be able to attach the receipt for it, and that
   * includes a vendor, who holds no media permissions at all. Attaching a
   * document to a support case went through the *profile photograph* route
   * before this existed, which refused every PDF anybody tried.
   */
  @ApiBearerAuth()
  @RequirePermissions(Permission.CASE_RAISE)
  @ApiOperation({ summary: 'Get an upload URL for evidence — an image or a PDF' })
  @Post('attachment/presign')
  @RawMediaRefs()
  presignAttachment(
    @CurrentUser() actor: AuthUser,
    @Body() dto: PresignAttachmentDto,
    @Req() req: Request,
  ) {
    return this.media.presignUpload(
      actor,
      { owner: 'users', id: actor.userId, area: 'attachments' },
      dto,
      requestOrigin(req),
    );
  }

  /**
   * An upload slot for what a provider hands the couple: the photographer's
   * edited set, the videographer's film, an album proof.
   *
   * Filed under the booking (bookings/{id}/deliveries/…) rather than under the
   * provider, because the booking is what decides who may open it: the
   * customer, their match-fixed partner and the provider, and nobody else.
   * Attach the result to the booking as delivery evidence (PUT
   * /bookings/:id/complete).
   */
  @ApiBearerAuth()
  @RequirePermissions(Permission.BOOKING_COMPLETE)
  @ApiOperation({ summary: 'Get an upload URL for a delivery to the couple on a booking' })
  @Post('bookings/:bookingId/deliveries/presign')
  @RawMediaRefs()
  presignDelivery(
    @CurrentUser() actor: AuthUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: PresignBookingFileDto,
    @Req() req: Request,
  ) {
    return this.media.presignUpload(
      actor,
      { owner: 'bookings', id: bookingId, area: 'deliveries' },
      dto,
      requestOrigin(req),
    );
  }

  /**
   * An upload slot for a reference on an existing booking: the look the couple
   * want, the venue plan. Either side of the booking may add one. A booking
   * request that does not exist yet uses the attachment slot instead.
   */
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get an upload URL for a reference file on a booking' })
  @Post('bookings/:bookingId/references/presign')
  @RawMediaRefs()
  presignReference(
    @CurrentUser() actor: AuthUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: PresignBookingFileDto,
    @Req() req: Request,
  ) {
    return this.media.presignUpload(
      actor,
      { owner: 'bookings', id: bookingId, area: 'references' },
      dto,
      requestOrigin(req),
    );
  }

  /**
   * The server-side half of an upload: reads the object back and refuses it
   * (deleting it) if it is empty, too large, or not the kind of file its name
   * says. Optional for older clients; the web and mobile uploaders call it.
   */
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm an upload finished and is acceptable' })
  @Post('complete')
  @RawMediaRefs()
  complete(@CurrentUser() actor: AuthUser, @Body() dto: CompleteUploadDto, @Req() req: Request) {
    return this.media.completeUpload(actor, dto.key, requestOrigin(req), dto.purpose);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'A fresh link to a stored file, or a download link' })
  @Post('sign')
  @RawMediaRefs()
  sign(@CurrentUser() actor: AuthUser, @Body() dto: SignMediaDto, @Req() req: Request) {
    return this.media.sign(actor, dto, requestOrigin(req));
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @Post('albums/:id/items')
  addItem(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMediaItemDto,
  ) {
    return this.media.addItem(userId, id, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @Get('albums/:id/items')
  listItems(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.listItems(userId, id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @ApiOperation({ summary: 'Remove one photograph from an album' })
  @Delete('albums/:id/items/:itemId')
  removeItem(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.media.removeItem(userId, id, itemId);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @ApiOperation({
    summary: 'Delete an album and everything in it',
    description:
      'The photographs go with it. There is no cascade on the key, so removing the album alone ' +
      'would leave them as rows pointing at nothing.',
  })
  @Delete('albums/:id')
  removeAlbum(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.removeAlbum(userId, id);
  }

  @Public()
  @Get('shared/:token')
  shared(@Param('token') token: string) {
    return this.media.getShared(token);
  }
}
