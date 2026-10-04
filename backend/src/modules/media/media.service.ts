import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Album } from './entities/album.entity';
import { MediaItem } from './entities/media-item.entity';
import { AddMediaItemDto, CreateAlbumDto, SignMediaDto, UploadDetailsDto } from './dto/media.dto';
import { MediaAccessService } from './media-access.service';
import { StorageService } from '../../platform/storage/storage.service';
import { KeyScope, buildKey, isSafeKey, parseKey, refKey } from '../../platform/storage/storage-keys';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AppConfigService } from '../../config/app-config.service';
import { MediaType, UserRole } from '../../common/enums';
import { ModerationService } from '../../platform/moderation/moderation.service';

/** An album as the gallery screen needs it: what is in it, and what it looks like. */
export interface AlbumCard extends Album {
  itemCount: number;
  coverUrl: string | null;
  shareUrl: string | null;
}

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(Album) private readonly albums: Repository<Album>,
    @InjectRepository(MediaItem) private readonly items: Repository<MediaItem>,
    private readonly storage: StorageService,
    private readonly access: MediaAccessService,
    private readonly cfg: AppConfigService,
    private readonly moderation: ModerationService,
  ) {}

  createAlbum(userId: string, dto: CreateAlbumDto) {
    return this.albums.save(
      this.albums.create({
        userId,
        title: dto.title,
        isPublic: dto.isPublic ?? false,
        shareToken: randomUUID(),
      }),
    );
  }

  /**
   * The albums, as cards rather than as rows.
   *
   * A list of titles is not a photo album — it is a list of titles. What makes
   * the screen usable is the count and the cover, and both were left to the
   * client, which could only get them by opening every album in turn. One query
   * for the counts and one for the covers beats N of each.
   */
  async listAlbums(userId: string): Promise<AlbumCard[]> {
    const albums = await this.albums.find({ where: { userId }, order: { createdAt: 'DESC' } });
    if (albums.length === 0) return [];

    const ids = albums.map((a) => a.id);
    const items = await this.items.find({
      where: { albumId: In(ids) },
      order: { createdAt: 'ASC' },
    });

    return albums.map((album) => {
      const mine = items.filter((i) => i.albumId === album.id);
      return {
        ...album,
        itemCount: mine.length,
        // The first photograph added, not the newest. An album's cover
        // changing every time somebody uploads is disorienting on a screen
        // people recognise their own albums by.
        coverUrl: mine.find((i) => i.type === MediaType.IMAGE)?.url ?? null,
        shareUrl: album.isPublic ? `${this.cfg.media.shareBaseUrl}/${album.shareToken}` : null,
      };
    });
  }

  /**
   * Removes one photograph.
   *
   * Ownership is checked through the album rather than on the item, so an item
   * id from somebody else's album resolves to nothing rather than to a
   * deletion.
   */
  async removeItem(userId: string, albumId: string, itemId: string) {
    const album = await this.getOwnedAlbum(userId, albumId);
    const result = await this.items.delete({ id: itemId, albumId: album.id });
    if (!result.affected) throw new NotFoundException('That photo is not in this album');
    return { removed: true };
  }

  /**
   * Removes an album and everything in it.
   *
   * The items go first and explicitly. There is no cascade on the foreign key,
   * so deleting the album alone would leave its photographs behind as rows
   * pointing at nothing — invisible, undeletable, and counted by nothing.
   */
  async removeAlbum(userId: string, albumId: string) {
    const album = await this.getOwnedAlbum(userId, albumId);
    await this.items.delete({ albumId: album.id });
    await this.albums.delete({ id: album.id });
    return { removed: true };
  }

  /**
   * An upload slot under a key the caller owns.
   *
   * The key is built here, from the scope the route decided, and never taken
   * from the client — so where a file lands is a fact about who uploaded it
   * and what for, and the access rules can be read back off the key.
   */
  async presignUpload(
    actor: AuthUser,
    scope: KeyScope,
    file: UploadDetailsDto & { filename: string },
    requestOrigin?: string,
  ) {
    const key = buildKey(scope, file.filename);
    if (!(await this.access.canUpload(actor, key))) {
      throw new ForbiddenException(
        scope.owner === 'bookings' && scope.area === 'deliveries'
          ? 'Only the provider on this booking can upload its deliveries'
          : 'You cannot upload files there',
      );
    }
    return this.storage.presignUpload(key, {
      size: file.size,
      contentType: file.contentType,
      requestOrigin,
    });
  }

  /** A profile photograph, or with `purpose: 'portfolio'` one for the caller's listing. */
  async presignProfilePhoto(
    actor: AuthUser,
    file: UploadDetailsDto & { filename: string; purpose?: 'profile' | 'portfolio' },
    requestOrigin?: string,
  ) {
    if (file.purpose === 'portfolio') {
      const vendorId = await this.access.vendorIdOf(actor.userId);
      if (!vendorId) throw new BadRequestException('There is no vendor listing on this account');
      return this.presignUpload(actor, { owner: 'vendors', id: vendorId, area: 'portfolio' }, file, requestOrigin);
    }
    return this.presignUpload(actor, { owner: 'users', id: actor.userId, area: 'profile' }, file, requestOrigin);
  }

  async presignAlbumPhoto(
    actor: AuthUser,
    albumId: string,
    file: UploadDetailsDto & { filename: string },
    requestOrigin?: string,
  ) {
    await this.getOwnedAlbum(actor.userId, albumId);
    return this.presignUpload(actor, { owner: 'users', id: actor.userId, area: 'albums' }, file, requestOrigin);
  }

  /**
   * Confirms an upload landed as promised (StorageService.verifyUpload).
   *
   * Only for a key the caller could have been issued, so it cannot be used to
   * probe, or delete, somebody else's files.
   */
  async completeUpload(
    actor: AuthUser,
    key: string,
    requestOrigin?: string,
    purpose?: 'profile_photo',
  ) {
    if (!(await this.access.canUpload(actor, key))) {
      throw new ForbiddenException('That is not one of your uploads');
    }
    const upload = await this.storage.verifyUpload(key, requestOrigin);

    // A photograph of a person, checked as soon as its bytes are in: the
    // uploader has not shown it as added yet, so a refusal here leaves nothing
    // half-attached on screen. The file is deleted rather than left to the
    // lifecycle sweep — nobody should be able to link to it in the meantime.
    // Only images in a profile slot; documents and videos are not portraits.
    if (
      purpose === 'profile_photo' &&
      parseKey(key)?.area === 'profile' &&
      upload.contentType.startsWith('image/')
    ) {
      try {
        await this.moderation.assertGenuinePhoto(upload.ref, {
          userId: actor.userId,
          kind:
            actor.role === UserRole.AGENT || actor.role === UserRole.FAMILY ? 'managed_profile' : 'profile',
        });
      } catch (err) {
        await this.storage.driver.delete(key).catch(() => undefined);
        throw err;
      }
    }
    return upload;
  }

  /**
   * A fresh link to one stored file, for whoever may open it.
   *
   * Responses already carry signed links; this is for a link that has expired
   * on a page left open, and for a download — a couple saving the whole of a
   * photographer's delivery wants files, not tabs.
   */
  async sign(actor: AuthUser, dto: SignMediaDto, requestOrigin?: string) {
    const key = refKey(dto.ref) ?? (isSafeKey(dto.ref) ? dto.ref : this.storage.keyOf(dto.ref));
    if (!key) throw new BadRequestException('That is not a stored file');
    if (!(await this.access.canView(actor, key))) {
      throw new ForbiddenException('You cannot open that file');
    }
    const url = await this.storage.signedUrl(key, {
      requestOrigin,
      downloadName: dto.download ? key.slice(key.lastIndexOf('/') + 1) : undefined,
    });
    // The least the link is good for (see S3StorageDriver.urlFor); null when
    // the local store's links never expire.
    return {
      url,
      expiresIn: this.storage.isPrivate ? Math.floor(this.cfg.media.getExpirySeconds / 2) : null,
    };
  }

  async addItem(userId: string, albumId: string, dto: AddMediaItemDto) {
    const album = await this.getOwnedAlbum(userId, albumId);

    // Album photographs are shareable, and a shared album is a claim about a
    // real wedding in the same way a profile is a claim about a real person.
    // Videos are left alone: the detector scores stills.
    if ((dto.type ?? MediaType.IMAGE) === MediaType.IMAGE) {
      await this.moderation.assertGenuinePhoto(dto.url, { userId, kind: 'album' });
    }

    return this.items.save(
      this.items.create({
        albumId: album.id,
        url: dto.url,
        type: dto.type ?? MediaType.IMAGE,
        caption: dto.caption,
      }),
    );
  }

  async listItems(userId: string, albumId: string) {
    await this.getOwnedAlbum(userId, albumId);
    return this.items.find({ where: { albumId }, order: { createdAt: 'DESC' } });
  }

  /** Public shareable view, resolves an album (and its items) by share token. */
  async getShared(shareToken: string) {
    const album = await this.albums.findOne({ where: { shareToken, isPublic: true } });
    if (!album) throw new NotFoundException('Shared album not found');
    const items = await this.items.find({ where: { albumId: album.id } });
    return { album, items, shareUrl: `${this.cfg.media.shareBaseUrl}/${shareToken}` };
  }

  private async getOwnedAlbum(userId: string, albumId: string): Promise<Album> {
    const album = await this.albums.findOne({ where: { id: albumId } });
    if (!album) throw new NotFoundException('Album not found');
    if (album.userId !== userId) throw new ForbiddenException('Not your album');
    return album;
  }
}
