// Stáhne oficiální sdílené testovací certifikáty pro playground EET do .fixtures/playground/ (ADR-011).
// Finanční správa je zveřejňuje pro všechny vývojáře a po 366 dnech je obmění, proto nejsou v repozitáři.
// Rozbalení používá systémový příkaz `unzip`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const ZIP_URL = 'https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/CAEET_Playground_2026_v1.zip';
const targetDir = new URL('../.fixtures/playground/', import.meta.url);
const passwordFile = new URL('password_pokladni_cert_playground.txt', targetDir);

if (existsSync(passwordFile) && !process.argv.includes('--force')) {
  console.log('Testovací certifikáty už jsou stažené v .fixtures/playground/ (přestažení: --force).');
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
console.log(`Stahuji ${ZIP_URL}`);
const response = await fetch(ZIP_URL);
if (!response.ok) {
  console.error(`Stažení selhalo: HTTP ${response.status}`);
  process.exit(1);
}
const zipFile = new URL('certificates.zip', targetDir);
writeFileSync(zipFile, Buffer.from(await response.arrayBuffer()));
execFileSync('unzip', ['-o', '-q', zipFile.pathname, '-d', targetDir.pathname], { stdio: 'inherit' });
console.log('Testovací certifikáty jsou v .fixtures/playground/.');
