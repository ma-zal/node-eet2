import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { AppContext } from '../app.js';

/**
 * `GET /healthy` pro Docker healthcheck (ADR-008). Chybu vrací jen při prošlém certifikátu.
 * Služba bez certifikátu (čerstvé nasazení) je zdravá. Čte jen stav v paměti, nikdy nevolá síť.
 */
export function healthyRoute(context: AppContext): FastifyPluginAsyncTypebox {
  return async (fastify) => {
    fastify.get('/healthy', async (_request, reply) => {
      const expired = context.manager.getStatus().renewal.state === 'expired';
      return reply.code(expired ? 503 : 200).send({ status: expired ? 'certificate_expired' : 'ok' });
    });
  };
}
