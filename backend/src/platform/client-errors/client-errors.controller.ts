import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { OptionalAuth, Public } from '../../common/decorators/public.decorator';
import { ClientErrorsService } from './client-errors.service';
import { ClientErrorDto } from './dto/client-error.dto';

type ClientRequest = Request & { id?: string; user?: AuthUser };

@Controller('telemetry/client-errors')
export class ClientErrorsController {
  constructor(private readonly errors: ClientErrorsService) {}

  @Public()
  @OptionalAuth()
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @Post()
  @HttpCode(202)
  accept(@Body() dto: ClientErrorDto, @Req() request: ClientRequest) {
    const event = this.errors.report(dto, request.user, request.id);
    return { accepted: true, requestId: event.requestId };
  }
}
