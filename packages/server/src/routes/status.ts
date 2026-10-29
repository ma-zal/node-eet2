import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { AppContext } from '../app.js';

/** `GET /api/v1/status` – prostředí, verze, certifikát, stav obnovy, poslední úspěch a chyba (ADR-005). */
export function statusRoute(context: AppContext): FastifyPluginAsyncTypebox {
  return async (fastify) => {
    fastify.get('/api/v1/status', async () => {
      const { activity } = context;
      return {
        environment: context.environment,
        ...context.versions,
        key_encrypted: context.keyEncrypted,
        ...context.manager.getStatus(),
        ...(activity.lastSuccessAt ? { last_success_at: activity.lastSuccessAt } : {}),
        ...(activity.lastError ? { last_error: activity.lastError } : {}),
      };
    });
  };
}
