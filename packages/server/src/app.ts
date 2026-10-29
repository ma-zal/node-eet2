import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { CertificateManager, EetClient, EetEnvironment, SendResult } from 'eet2-core';
import { log } from './logger.js';
import { certificateRoutes } from './routes/certificate.js';
import { healthyRoute } from './routes/healthy.js';
import { salesRoute } from './routes/sales.js';
import { statusRoute } from './routes/status.js';
import { apiError } from './schemas.js';
import type { Versions } from './versions.js';

export interface AppContext {
  environment: EetEnvironment;
  manager: CertificateManager;
  eetClient: EetClient;
  /** Ukládají se privátní klíče šifrovaně (`EET2_KEY_PASSPHRASE`). */
  keyEncrypted: boolean;
  versions: Versions;
  activity: SalesActivity;
  now: () => Date;
}

/** Poslední úspěch a chyba odesílání tržeb pro `GET /api/v1/status`. Jen v paměti, po restartu prázdné. */
export class SalesActivity {
  lastSuccessAt: string | undefined;
  lastError: { at: string; message: string } | undefined;

  record(result: SendResult, at: Date): void {
    if (result.result === 'accepted' || result.result === 'verified') {
      this.lastSuccessAt = at.toISOString();
      return;
    }
    const { type, kod, message } = result.error;
    this.lastError = { at: at.toISOString(), message: `${type}${kod === undefined ? '' : ` ${kod}`}: ${message}` };
  }
}

export interface BuildAppOptions extends Omit<AppContext, 'activity' | 'now'> {
  now?: () => Date;
}

/** Sestaví Fastify aplikaci. Vestavěný logger Fastify je vypnutý, loguje se přes logger.ts (ADR-012). */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const context: AppContext = { ...options, activity: new SalesActivity(), now: options.now ?? (() => new Date()) };

  const app = Fastify({ logger: false }).setValidatorCompiler(TypeBoxValidatorCompiler).withTypeProvider<TypeBoxTypeProvider>();

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      return reply.code(400).send(apiError('validation', `Neplatný požadavek: ${error.message}`));
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send(apiError('validation', error.message));
    }
    log('error', 'request_failed', { method: request.method, url: request.url, message: error.message });
    return reply.code(500).send(apiError('internal', 'Interní chyba serveru.'));
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send(apiError('not_found', `Endpoint ${request.method} ${request.url} neexistuje.`)));

  app.register(healthyRoute(context));
  app.register(statusRoute(context));
  app.register(salesRoute(context));
  app.register(certificateRoutes(context));
  return app;
}
