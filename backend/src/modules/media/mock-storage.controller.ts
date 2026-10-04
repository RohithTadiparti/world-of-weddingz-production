import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { Public } from '../../common/decorators/public.decorator';
import { AppConfigService } from '../../config/app-config.service';
import { contentTypeFor } from '../../platform/storage/content-types';
import { resolveLocalPath } from '../../platform/storage/local-storage.driver';

/**
 * The storage the mock provider has been pointing at all along.
 *
 * `presign` returned `http://localhost:3000/mock-storage/...` and said uploads
 * "work end-to-end locally without AWS" — but nothing ever served that URL. The
 * browser PUT the file, got a 404 from the router, and the uploader reported
 * "That photo could not be uploaded". Every upload in every deployment not
 * configured for S3 failed at exactly that point: the agent's mandatory biodata
 * photograph, the support attachment, the album, the vendor's portfolio.
 *
 * It never showed up in a test because the suites post a literal
 * `https://cdn.example.com/...` and never PUT anything anywhere — the one step
 * that was broken was the one step nothing exercised.
 *
 * Registered whichever provider runs. With `MEDIA_STORAGE_PROVIDER=s3` uploads
 * go to the bucket and the PUT here is refused, but the GET keeps serving what
 * was stored before the switch: those URLs are absolute and already in the
 * database.
 */
@ApiExcludeController()
@Controller('mock-storage')
export class MockStorageController {
  constructor(private readonly cfg: AppConfigService) {}

  private pathFor(key: string): string {
    return resolveLocalPath(this.cfg.media.mockStorageDir, key);
  }

  @Public()
  // Express 4's wildcard, which is what Nest 10 is running. The named form
  // (`*key`) is Express 5 syntax and matches nothing here — it registered a
  // route that could never fire, so the PUT 404'd exactly as it did when there
  // was no route at all.
  @Put('*')
  put(@Req() req: Request & { rawBody?: Buffer }) {
    // Nothing may be written here once the bucket is the store: a file put
    // here would be public, and invisible to everything that reads the bucket.
    if (this.cfg.media.storageProvider !== 'mock') {
      throw new ForbiddenException('Uploads go to the configured storage, not here');
    }
    const objectKey = req.params[0] ?? '';
    const body = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : null);
    if (!body || body.length === 0) {
      throw new BadRequestException('Nothing to store');
    }
    if (body.length > this.cfg.media.maxFileSizeBytes) {
      throw new BadRequestException('That file is too large');
    }

    const target = this.pathFor(objectKey);
    /*
     * Write once, never replace.
     *
     * This route cannot be authenticated: with the real provider the browser
     * PUTs to a presigned S3 URL carrying its own auth and sends no bearer
     * token, so requiring one here would break every upload on the default
     * provider. What it can refuse is overwriting. Every media URL the API
     * hands out -- a profile photograph, a support-case attachment, the
     * evidence a provider files on a booking -- is also its own write address,
     * so without this anyone who had seen one could silently replace the bytes
     * behind it while the row, the history and the case all went on pointing at
     * the same URL (council review). presign mints a fresh random key per
     * upload, so a legitimate client never PUTs the same key twice.
     */
    if (existsSync(target)) {
      throw new ConflictException('That object already exists');
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    // S3 answers a successful PUT with an empty 200, so this does too — a
    // client written against the real provider must not need a second path.
    return '';
  }

  @Public()
  @Get('*')
  @Header('Cache-Control', 'public, max-age=3600')
  get(@Req() req: Request, @Res() res: Response) {
    const objectKey = req.params[0] ?? '';
    const target = this.pathFor(objectKey);
    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new NotFoundException('No such object');
    }

    res.setHeader('Content-Type', contentTypeFor(target));
    // Helmet sends `same-origin` for everything, which is right for the API and
    // wrong for a stand-in for a CDN: a photo uploaded through one origin (the
    // API port, a phone on the LAN) was refused as an <img> on another (the web
    // app), and every seeded portfolio showed as a broken image. Real S3 or a
    // CDN serves these cross-origin, so the mock does too.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    createReadStream(target).pipe(res);
  }
}
