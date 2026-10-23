import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// Inspect the publishable tree, including new files, rather than ignored runtime data.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const failures = [];
for (const file of new Set(files)) {
  if (!existsSync(file)) continue;
  if (/^(?:data|resources)\//.test(file) && !file.endsWith('/.gitkeep') || /^(?:curriculos|artifacts|exports|credentials|sessions)\//i.test(file) || /\.(?:sqlite3?|db|pdf|docx|pem|key|pfx|p12|zip)$/i.test(file) || /(?:^|\/)\.env(?:\..+)?$/.test(file) && file !== '.env.example') {
    failures.push(`${file}: private/runtime artifact`);
    continue;
  }
  if (/\.(?:png|jpe?g|gif|ico|woff2?)$/i.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  if (/^(?:<{7}|\|{7}|>{7})(?: |$)/m.test(text)) failures.push(`${file}: unresolved merge`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) failures.push(`${file}: private key`);
  if (/\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}\b/.test(text)) failures.push(`${file}: GitHub credential`);
}
const env = readFileSync('.env.example', 'utf8');
if (!/^CAREER_SUBMISSION_ENABLED=false\s*$/m.test(env)) failures.push('.env.example: external submission must default off');
for (const key of ['GITHUB_TOKEN', 'EVOLUTION_API_KEY', 'CAREER_WHATSAPP_TARGET', 'CAREER_WHATSAPP_APPROVER', 'CAREER_EVOLUTION_WEBHOOK_SECRET']) {
  if (new RegExp(`^${key}=.+`, 'm').test(env)) failures.push(`.env.example: ${key} must be empty`);
}
const { SUBMIT_EVIDENCE } = await import('../src/automation/ats/submit-homologation.mjs');
if (SUBMIT_EVIDENCE.length) failures.push('Community must not inherit private submission receipts');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Public release boundaries: PASS (${new Set(files).size} files). This is not a complete secret audit.`);
