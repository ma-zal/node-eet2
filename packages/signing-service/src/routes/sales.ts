import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { RejectedResult } from 'eet2-core';
import type { AppContext } from '../app.js';
import { log } from '../logger.js';
import { apiError, SaleRequestSchema } from '../schemas.js';

/**
 * `POST /api/v1/sales` – podepíše a odešle jednu tržbu (ADR-005, ADR-006).
 *
 * Neplatná data (včetně chybějících položek) vrací HTTP 200 s `result: rejected`, aby je volající
 * neopakoval. HTTP 503 znamená, že chybí platný certifikát, HTTP 409, že certifikát je pro jiné prostředí,
 * než do kterého tržba patří. V obou případech má volající tržbu poslat později.
 */
export function salesRoute(context: AppContext): FastifyPluginAsyncTypebox {
  return async (fastify) => {
    fastify.post('/api/v1/sales', { schema: { body: SaleRequestSchema }, attachValidation: true }, async (request, reply) => {
      if (request.validationError) {
        const rejected: RejectedResult = {
          result: 'rejected',
          error: { type: 'validation', message: `Neplatný požadavek: ${request.validationError.message}` },
          duration_ms: 0,
        };
        log('warn', 'sale_invalid_request', { message: request.validationError.message });
        return rejected;
      }

      const credentials = context.manager.getCredentials();
      const environment = context.manager.getEnvironment();
      if (!credentials || !environment) {
        return reply.code(503).send(apiError('no_certificate', 'Není nahrán pokladní certifikát.'));
      }
      const now = context.now().getTime();
      if (now < Date.parse(credentials.valid_from) || now >= Date.parse(credentials.valid_to)) {
        return reply
          .code(503)
          .send(
            apiError(
              'no_certificate',
              `Pokladní certifikát není platný (platnost ${credentials.valid_from} – ${credentials.valid_to}). Nahrajte nový certifikát.`,
            ),
          );
      }

      if (request.body.environment !== environment) {
        log('warn', 'sale_environment_mismatch', { porad_cis: request.body.data.porad_cis, environment: request.body.environment });
        return reply
          .code(409)
          .send(
            apiError(
              'environment_mismatch',
              `Tržba patří do prostředí ${request.body.environment}, nahraný certifikát je pro prostředí ${environment}.`,
            ),
          );
      }

      const result = await context.eetClients[environment].sendSale(request.body, credentials);
      context.activity.record(result, context.now());

      const error = result.result === 'rejected' || result.result === 'retry' ? result.error : undefined;
      log(error ? 'warn' : 'info', 'sale_sent', {
        environment,
        porad_cis: request.body.data.porad_cis,
        celk_trzba: request.body.data.celk_trzba,
        prvni_zaslani: request.body.prvni_zaslani,
        overeni: request.body.overeni,
        result: result.result,
        uuid_zpravy: result.uuid_zpravy,
        test: result.test,
        error_type: error?.type,
        kod: error?.kod,
        message: error?.message,
        warnings: result.result === 'accepted' || result.result === 'verified' ? result.warnings.length : undefined,
        global_transaction_id: result.global_transaction_id,
        duration_ms: result.duration_ms,
      });
      if (result.result === 'accepted' && !result.signature_valid) {
        log('warn', 'response_signature_invalid', { uuid_zpravy: result.uuid_zpravy, reason: result.signature_error });
      }
      return result;
    });
  };
}
