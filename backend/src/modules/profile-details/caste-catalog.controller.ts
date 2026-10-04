import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { casteCatalogResponse } from './caste-catalog';

@ApiTags('reference')
@ApiBearerAuth()
@Controller('reference')
export class CasteCatalogController {
  @Get('castes')
  @ApiOperation({ summary: 'Commonly reported caste and sub-caste options' })
  list() {
    return {
      classificationNote:
        'Options are commonly reported labels, not an official universal classification.',
      castes: casteCatalogResponse(),
    };
  }
}