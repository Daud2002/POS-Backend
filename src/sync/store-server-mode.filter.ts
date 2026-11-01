import { ArgumentsHost, Catch, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';

/**
 * Turns the sync guard's refusals into a clear 409 instead of a 500.
 *
 * The capture triggers raise TNT_STORE_SERVER_MODE when the cloud is asked
 * to write something only a store's in-shop server may write (an order, a
 * table, a shift), and TNT_STORE_SERVER_READ_ONLY when a store server that
 * is not (or no longer) the store's writer is asked to. Clients key on
 * `code`; every other database error goes on to Nest's usual handling.
 */
@Catch(QueryFailedError)
export class StoreServerModeFilter extends BaseExceptionFilter {
  catch(error: QueryFailedError, host: ArgumentsHost) {
    const message = String((error as any)?.driverError?.message ?? error.message);
    const code = message.includes('TNT_STORE_SERVER_MODE')
      ? 'STORE_SERVER_MODE'
      : message.includes('TNT_STORE_SERVER_READ_ONLY')
        ? 'STORE_SERVER_READ_ONLY'
        : null;
    if (!code || host.getType() !== 'http') return super.catch(error, host);

    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.CONFLICT)
      .json({
        statusCode: HttpStatus.CONFLICT,
        code,
        message:
          code === 'STORE_SERVER_MODE'
            ? "This store takes orders on its in-shop server. Connect to the shop's Wi-Fi to use it."
            : 'This store server is not the active one for the store yet. Activate it from the cloud settings.',
      });
  }
}
