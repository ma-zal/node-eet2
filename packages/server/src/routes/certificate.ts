import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { EetCertificateError } from 'cz-eet2-core';
import type { AppContext } from '../app.js';
import { log } from '../logger.js';
import { apiError, CertificateUploadSchema } from '../schemas.js';

/** Nahrání certifikátu a ruční spuštění obnovy (ADR-007, ADR-008). */
export function certificateRoutes(context: AppContext): FastifyPluginAsyncTypebox {
  return async (fastify) => {
    // Tělo obsahuje .p12 a heslo – nikdy ho nelogovat.
    fastify.put('/api/v1/certificate', { schema: { body: CertificateUploadSchema } }, async (request, reply) => {
      try {
        const { pkcs12, password, environment } = request.body;
        const status = await context.manager.installPkcs12(Buffer.from(pkcs12, 'base64'), password, environment);
        log('info', 'certificate_installed', {
          environment,
          eic: status.certificate?.eic,
          serial_number: status.certificate?.serial_number,
          valid_to: status.certificate?.valid_to,
        });
        return status;
      } catch (error) {
        if (error instanceof EetCertificateError) {
          log('warn', 'certificate_rejected', { message: error.message });
          return reply.code(400).send(apiError('invalid_certificate', error.message));
        }
        throw error;
      }
    });

    // Obnova může trvat i minuty (čekání na CA), proto běží na pozadí; průběh je vidět v GET /api/v1/status.
    fastify.post('/api/v1/certificate/renew', async (_request, reply) => {
      const status = context.manager.getStatus();
      if (!status.certificate) {
        return reply.code(409).send(apiError('no_certificate', 'Není nahrán pokladní certifikát.'));
      }
      if (!status.renewal.automatic) {
        return reply
          .code(409)
          .send(apiError('renewal_unavailable', 'Automatická obnova není k dispozici: CA EET API není nakonfigurované (playground nebo caApiUrl: null).'));
      }
      if (status.renewal.state === 'expired') {
        return reply
          .code(409)
          .send(apiError('renewal_unavailable', 'Certifikát vypršel, automatická obnova není možná. Vydejte nový certifikát v DIS+ a nahrajte ho.'));
      }
      context.manager.renewNow().catch((error: unknown) => {
        log('error', 'certificate_renewal_failed', { message: error instanceof Error ? error.message : String(error) });
      });
      return reply.code(202).send(context.manager.getStatus());
    });
  };
}
