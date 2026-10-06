import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const approved = new Set([
  'backend/src/config/configuration.ts',
  'backend/src/database/seed-admin.ts',
  'backend/src/database/seed-demo.ts',
  'backend/src/common/dto/pagination.dto.ts',
  'backend/src/common/websocket/socket-origin.ts',
  'backend/src/modules/auth/auth.controller.ts',
  'backend/src/modules/chat/chat.gateway.ts',
  'backend/src/modules/verification/entities/officer-availability.entity.ts',
  'backend/src/platform/storage/s3-storage.minio.spec.ts',
]);

const files = execFileSync('git', ['ls-files', 'backend/src/**/*.ts'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
const violations = files.filter((file) => {
  if (file.startsWith('backend/src/config/') || approved.has(file)) return false;
  const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return /\bprocess\.env\b/.test(source);
});

if (violations.length) {
  console.error('Direct process.env access is outside the approved configuration boundary:');
  violations.forEach((file) => console.error(` - ${file}`));
  process.exit(1);
}
console.log(`Configuration boundary verified across ${files.length} backend TypeScript files.`);
