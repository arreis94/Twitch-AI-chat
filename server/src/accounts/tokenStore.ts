import fs from 'node:fs/promises';
import path from 'node:path';
import type { AccessToken } from '@twurple/auth';
import { TOKENS_DIR } from '../config';

function tokenPath(userId: string): string {
  return path.join(TOKENS_DIR, `${userId}.json`);
}

export async function saveToken(userId: string, token: AccessToken): Promise<void> {
  await fs.writeFile(tokenPath(userId), JSON.stringify(token, null, 2), 'utf-8');
}

export async function loadToken(userId: string): Promise<AccessToken | null> {
  try {
    const raw = await fs.readFile(tokenPath(userId), 'utf-8');
    return JSON.parse(raw) as AccessToken;
  } catch {
    return null;
  }
}

export async function deleteToken(userId: string): Promise<void> {
  await fs.rm(tokenPath(userId), { force: true });
}
