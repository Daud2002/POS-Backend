import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { clientIp, userAgentOf } from '../common/request-meta';
import { describeRequest, MUTATING_METHODS, normalizeRoutePath, patternFromParams } from './audit-routes';
import { AuditService } from './audit.service';

/**
 * Records every successful write as an audit row.
 *
 * Global (APP_INTERCEPTOR), so it sees every controller without any of them
 * knowing. It runs AFTER the guards, which is what makes `req.user` — the full
 * profile from JwtStrategy, store and effective role included — available to
 * attribute the write.
 *
 * Only the success path logs: a rejected request changed nothing. The row is
 * written fire-and-forget inside its own try/catch, so neither a slow insert
 * nor a broken summary can touch the response the caller is waiting for.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // The socket gateway shares the application; only HTTP writes are audited.
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const method = String(req?.method ?? '').toUpperCase();
    if (!MUTATING_METHODS.has(method)) return next.handle();

    return next.handle().pipe(
      tap({
        next: (response) => this.record(context, method, response),
        error: () => {
          // Failed writes are not audited.
        },
      }),
    );
  }

  private record(context: ExecutionContext, method: string, response: unknown): void {
    try {
      const http = context.switchToHttp();
      const req = http.getRequest();
      const res = http.getResponse();
      const params: Record<string, string | undefined> = req.params ?? {};

      // Express attaches the matched route (with the global prefix) to the
      // request; fall back to rebuilding the pattern from the params.
      const routePath = req.route?.path
        ? normalizeRoutePath(String(req.route.path))
        : patternFromParams(String(req.path ?? req.originalUrl ?? ''), params);

      // Read the body HERE, not in intercept(): for multipart routes multer
      // only populates req.body/req.file once the method-level FileInterceptor
      // has run, which is after a global interceptor's first look.
      const description = describeRequest({
        method,
        routePath,
        params,
        body: req.body,
        response,
        user: req.user ?? null,
        file: req.file
          ? { mimetype: req.file.mimetype, size: req.file.size, originalname: req.file.originalname }
          : null,
      });
      if (!description) return;

      void this.audit.log({
        ...description,
        method,
        path: String(req.originalUrl ?? req.url ?? '').split('?')[0].slice(0, 200),
        statusCode: Number(res?.statusCode) || 200,
        ip: clientIp(req),
        userAgent: userAgentOf(req),
      });
    } catch (error) {
      this.logger.warn(`Audit skipped: ${(error as Error)?.message ?? error}`);
    }
  }
}
