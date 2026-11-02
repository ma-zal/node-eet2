import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface Versions {
  service_version: string;
  core_version: string;
  /** Commit, ze kterého je image sestavený (build argument `GIT_SHA`). */
  git_sha?: string;
}

/** Verze služby a core pro dohledatelnost (ADR-003). */
export function readVersions(): Versions {
  // src/ i dist/ leží o úroveň níž než package.json.
  const service = require('../package.json') as { version: string };
  const core = require('eet2-core/package.json') as { version: string };
  const gitSha = process.env.GIT_SHA?.trim();
  return {
    service_version: service.version,
    core_version: core.version,
    ...(gitSha ? { git_sha: gitSha } : {}),
  };
}
