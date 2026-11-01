import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { promises as fs } from 'fs';
import { AppModule } from './app.module';
import { UPLOAD_DIR, LOGO_DIR } from './modules/stores/stores.service';
import { deploymentMode } from './config/deployment';
import { isAllowedOrigin } from './config/cors';
import { StoreServerModeFilter } from './sync/store-server-mode.filter';
import { TlsFiles, ensureTls, localHosts } from './store-server/tls';
import {
  guardStoreServerRoutes,
  httpPort,
  httpsPort,
  serveWebApp,
  setupRoutes,
  startHttpListener,
} from './store-server/hosting';

async function bootstrap() {
  // .env is already loaded: AppModule's import above ran ConfigModule.forRoot().
  const mode = deploymentMode();

  // A store server is HTTPS from the first request, with the shop's own CA.
  let tls: TlsFiles | null = mode === 'store' ? ensureTls(localHosts()) : null;
  if (tls) process.env.TNT_CA_SHA256 = tls.caSha256;

  // Typed as NestExpressApplication so useStaticAssets() below is available.
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    tls ? { httpsOptions: { key: tls.key, cert: tls.cert } } : undefined,
  );

  // Before any route: blocks cloud-only endpoints, sends plain HTTP to HTTPS.
  if (mode === 'store') guardStoreServerRoutes(app);

  // The cloud sits behind a proxy that forwards /api/*; without this every
  // client shares the proxy's address in `req.ip`, which the audit log and
  // the impersonation rate limit both key on. A store server has no proxy in
  // front of it, so trusting X-Forwarded-For there would let any device on
  // the shop Wi-Fi pick its own `req.ip` and dodge the login rate limit.
  if (mode === 'cloud') app.set('trust proxy', 1);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) return callback(null, true);

      if (isAllowedOrigin(origin, mode)) {
        callback(null, true); // allow this origin
      } else {
        callback(new Error('Not allowed by CORS')); // block
      }
    },
    credentials: true,
  });

  // Express's default 100 kB is too small for a sync push: a page carries up
  // to 500 full rows, and a store's logo alone can be 500 kB.
  app.useBodyParser('json', { limit: '25mb' });

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // The sync's single-writer refusals become a 409 with a code clients act on.
  app.useGlobalFilters(new StoreServerModeFilter(app.get(HttpAdapterHost).httpAdapter));

  // Add API prefix
  app.setGlobalPrefix('api');

  /**
   * Uploaded tenant assets (currently store logos).
   *
   * Served under '/api/uploads/' even though static assets bypass
   * setGlobalPrefix: deployments front this service with a proxy that
   * forwards '/api/*', so anything at the bare root would 404 in production.
   *
   * The CORS allowlist above does not apply — an <img> loads no-cors, and the
   * mobile Image component sends no Origin.
   */
  await fs.mkdir(LOGO_DIR, { recursive: true });
  app.useStaticAssets(UPLOAD_DIR, {
    prefix: '/api/uploads/',
    // Filenames are timestamped, so a replaced logo gets a fresh URL and this
    // can be cached hard.
    maxAge: '7d',
    index: false,
    dotfiles: 'deny',
  });

  /**
   * Legacy logo paths whose file is gone answer with an EMPTY 404.
   *
   * Logos now live in the database (GET /stores/:id/logo), because this
   * container's disk is wiped on every deploy. Rows written before that still
   * point at `/uploads/logo/...`; without this handler such a request fell
   * through to Nest's JSON 404, and a browser that asked for an image and got
   * `application/json` refuses to hand it over — Chrome logs it as
   * ERR_BLOCKED_BY_ORB. An empty 404 is a plain broken image the UI hides.
   */
  app.use('/api/uploads', (_req: Request, res: Response) => {
    res.status(404).end();
  });

  // Not on a store server: customers share the shop Wi-Fi, and an open map of
  // every endpoint is no help to anyone legitimate there.
  if (mode === 'cloud') {
    const config = new DocumentBuilder()
      .setTitle('POS System API')
      .setDescription('Point of Sale System API Documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Auth', 'Authentication endpoints')
      .addTag('Products', 'Product management endpoints')
      .addTag('Categories', 'Category management endpoints')
      .addTag('Customers', 'Customer management endpoints')
      .addTag('Orders', 'Order management endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  if (mode === 'store') {
    setupRoutes(app, () => tls!);
    const web = serveWebApp(app);
    await app.listen(httpsPort());
    startHttpListener(app);
    console.log(`Store server running on https://localhost:${httpsPort()} · setup on http://localhost:${httpPort()}/setup`);
    console.log(web ? `Serving the web app from ${web}` : 'No web app build found (set WEB_DIST_DIR)');

    // DHCP may move the PC to a new address; re-issue the certificate for it
    // in place, without a restart, and without needing the internet.
    setInterval(() => {
      const next = ensureTls(localHosts());
      if (next.reissued) {
        (app.getHttpServer() as import('https').Server).setSecureContext({ key: next.key, cert: next.cert });
        tls = next;
      }
    }, 5 * 60_000).unref();
    return;
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port} (${mode})`);
  console.log(`Swagger documentation available at: http://localhost:${port}/docs`);
}

bootstrap();
