import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { AppContext } from '../app.js';

/**
 * `GET /api/v1/status` – prostředí, verze, certifikát, stav obnovy, poslední úspěch a chyba (ADR-005).
 * Prostředí je podle nahraného certifikátu, bez certifikátu `null`.
 */
export function statusRoute(context: AppContext): FastifyPluginAsyncTypebox {
  return async (fastify) => {
    fastify.get('/api/v1/status', async () => {
      const { activity } = context;
      const { environment, ...certificateStatus } = context.manager.getStatus();
      return {
        environment: environment ?? null,
        ...context.versions,
        key_encrypted: context.keyEncrypted,
        ...certificateStatus,
        ...(activity.lastSuccessAt ? { last_success_at: activity.lastSuccessAt } : {}),
        ...(activity.lastError ? { last_error: activity.lastError } : {}),
      };
    });
  };
}
