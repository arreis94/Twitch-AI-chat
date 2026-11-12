import { RefreshingAuthProvider } from '@twurple/auth';
import { config } from '../config';
import { loadToken, saveToken } from './tokenStore';

/**
 * One RefreshingAuthProvider per test account. ChatClient resolves its login
 * identity through the provider's 'chat' intent, which only one user per
 * provider can hold — so sharing a provider across accounts is not possible.
 */
export async function createAuthProviderForUser(userId: string): Promise<RefreshingAuthProvider> {
  const token = await loadToken(userId);
  if (!token) {
    throw new Error(`No stored token for user ${userId} — onboard the account again`);
  }
  const provider = new RefreshingAuthProvider({
    clientId: config.TWITCH_CLIENT_ID,
    clientSecret: config.TWITCH_CLIENT_SECRET,
  });
  provider.onRefresh((id, newToken) => {
    void saveToken(id, newToken);
  });
  provider.addUser(userId, token, ['chat']);
  return provider;
}
