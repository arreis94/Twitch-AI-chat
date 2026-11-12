import fs from 'node:fs/promises';
import { exchangeCode, getTokenInfo } from '@twurple/auth';
import { ACCOUNTS_FILE, config } from '../config';
import { deleteToken, saveToken } from './tokenStore';

export interface Account {
  userId: string;
  userName: string;
  personaId?: string;
  addedAt: string;
}

const OAUTH_SCOPES = ['chat:read', 'chat:edit'];

export class AccountManager {
  private accounts: Account[] = [];

  constructor(private redirectUri: string) {}

  async load(): Promise<void> {
    try {
      this.accounts = JSON.parse(await fs.readFile(ACCOUNTS_FILE, 'utf-8')) as Account[];
    } catch {
      this.accounts = [];
    }
  }

  private async persist(): Promise<void> {
    await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(this.accounts, null, 2), 'utf-8');
  }

  list(): Account[] {
    return this.accounts;
  }

  get(userId: string): Account | undefined {
    return this.accounts.find((a) => a.userId === userId);
  }

  isTestAccount(userName: string): boolean {
    const lower = userName.toLowerCase();
    return this.accounts.some((a) => a.userName.toLowerCase() === lower);
  }

  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: config.TWITCH_CLIENT_ID,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: OAUTH_SCOPES.join(' '),
      force_verify: 'true',
    });
    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  /** Exchange the OAuth code, persist the token, and register the account. */
  async handleCallback(code: string): Promise<Account> {
    const token = await exchangeCode(
      config.TWITCH_CLIENT_ID,
      config.TWITCH_CLIENT_SECRET,
      code,
      this.redirectUri,
    );
    const info = await getTokenInfo(token.accessToken, config.TWITCH_CLIENT_ID);
    if (!info.userId || !info.userName) {
      throw new Error('Could not resolve user from token');
    }
    await saveToken(info.userId, token);

    const existing = this.get(info.userId);
    if (existing) {
      existing.userName = info.userName;
    } else {
      this.accounts.push({ userId: info.userId, userName: info.userName, addedAt: new Date().toISOString() });
    }
    await this.persist();
    return this.get(info.userId)!;
  }

  async remove(userId: string): Promise<void> {
    this.accounts = this.accounts.filter((a) => a.userId !== userId);
    await deleteToken(userId);
    await this.persist();
  }

  async assignPersona(userId: string, personaId: string | undefined): Promise<Account> {
    const account = this.get(userId);
    if (!account) throw new Error(`Unknown account ${userId}`);
    account.personaId = personaId;
    await this.persist();
    return account;
  }
}
