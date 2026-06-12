/**
 * Practice-chat seller persona (local role-play only).
 * Run vs seller uses the deployed seller-service — edit persona there, not here.
 * Optional override: PRACTICE_SELLER_SYSTEM_PROMPT in .env
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let cached;

export function getPracticeSellerSystemPrompt() {
  const envOverride = (process.env.PRACTICE_SELLER_SYSTEM_PROMPT || '').trim();
  if (envOverride) return envOverride;
  if (!cached) {
    cached = readFileSync(join(__dirname, '../data/practice-seller-persona.txt'), 'utf8').trim();
  }
  return cached;
}
