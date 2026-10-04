import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Album } from './entities/album.entity';
import { MediaItem } from './entities/media-item.entity';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { MockStorageController } from './mock-storage.controller';
import { MediaAccessService } from './media-access.service';
import { MediaUrlInterceptor } from './media-url.interceptor';
import { Vendor } from '../vendors/entities/vendor.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  imports: [TypeOrmModule.forFeature([Album, MediaItem, Vendor, ProfileDetails]), BookingsModule],
  providers: [
    MediaService,
    MediaAccessService,
    // Every HTTP response, not just this module's: a stored picture turns up
    // in profiles, listings, bookings, cases and chat alike.
    { provide: APP_INTERCEPTOR, useClass: MediaUrlInterceptor },
  ],
  // The local store is registered whichever driver runs. With the S3 driver it
  // no longer accepts uploads, but it still serves the files uploaded before
  // the switch, so every absolute /mock-storage/ URL already in the database
  // keeps working (see MockStorageController.put).
  controllers: [MediaController, MockStorageController],
  exports: [MediaService],
})
export class MediaModule {}
