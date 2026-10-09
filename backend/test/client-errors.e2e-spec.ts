import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('client error intake (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(() => app.close());

  it('accepts an anonymous allowlisted report', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/telemetry/client-errors')
      .set('X-Request-ID', 'browser-operation-1')
      .send({
        platform: 'web',
        route: '/login?return=/admin',
        category: 'network',
        message: 'Request failed',
      })
      .expect(202);
    expect(response.body).toEqual({ accepted: true, requestId: expect.any(String) });
  });

  it('rejects unknown fields and invalid platforms', async () => {
    await request(app.getHttpServer())
      .post('/api/telemetry/client-errors')
      .send({ platform: 'desktop', route: '/', category: 'render', message: 'failed', token: 'x' })
      .expect(400);
  });

  it('throttles the eleventh anonymous report in five minutes', async () => {
    const payload = { platform: 'web', route: '/', category: 'render', message: 'failed' };
    for (let index = 0; index < 10; index += 1) {
      await request(app.getHttpServer())
        .post('/api/telemetry/client-errors')
        .set('X-Forwarded-For', '198.51.100.199')
        .send(payload)
        .expect(202);
    }
    await request(app.getHttpServer())
      .post('/api/telemetry/client-errors')
      .set('X-Forwarded-For', '198.51.100.199')
      .send(payload)
      .expect(429);
  });
});
