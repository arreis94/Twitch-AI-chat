import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Project root = twitch-chat-sim/ (this file lives at server/src/config.ts)
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = process.env.DATA_DIR ?? path.join(PROJECT_ROOT, 'data');

loadEnv({ path: path.join(PROJECT_ROOT, '.env') });

const envSchema = z.object({
  TWITCH_CLIENT_ID: z.string().min(1, 'TWITCH_CLIENT_ID is required (see .env.example)'),
  TWITCH_CLIENT_SECRET: z.string().min(1, 'TWITCH_CLIENT_SECRET is required (see .env.example)'),
  TARGET_CHANNEL: z
    .string()
    .min(1, 'TARGET_CHANNEL is required (see .env.example)')
    .transform((s) => s.toLowerCase().replace(/^#/, '')),
  AZURE_AI_PROJECT_ENDPOINT: z.string().optional().transform((s) => s || undefined),
  AZURE_AI_MODEL_DEPLOYMENT: z.string().optional().transform((s) => s || undefined),
  PORT: z.coerce.number().int().positive().default(3000),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
export const aiConfigured = Boolean(config.AZURE_AI_PROJECT_ENDPOINT && config.AZURE_AI_MODEL_DEPLOYMENT);

export const TOKENS_DIR = path.join(DATA_DIR, 'tokens');
export const PERSONAS_DIR = path.join(DATA_DIR, 'personas');
export const SCENARIOS_DIR = path.join(DATA_DIR, 'scenarios');
export const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

for (const dir of [DATA_DIR, TOKENS_DIR, PERSONAS_DIR, SCENARIOS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
