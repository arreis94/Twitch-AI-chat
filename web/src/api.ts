import type { Account, AppStatus, Persona, Scenario, ScenarioStatus } from './types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    // Fastify rejects an empty body when Content-Type: application/json is set,
    // so only send the header alongside an actual body.
    ...(options?.body ? { headers: { 'Content-Type': 'application/json' } } : {}),
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export const api = {
  accounts: () => request<Account[]>('/api/accounts'),
  removeAccount: (userId: string) => request<void>(`/api/accounts/${userId}`, { method: 'DELETE' }),
  connectAccount: (userId: string) => request<void>(`/api/accounts/${userId}/connect`, { method: 'POST' }),
  disconnectAccount: (userId: string) => request<void>(`/api/accounts/${userId}/disconnect`, { method: 'POST' }),
  assignPersona: (userId: string, personaId: string | undefined) =>
    request<Account>(`/api/accounts/${userId}/persona`, { method: 'PUT', body: JSON.stringify({ personaId }) }),

  send: (accountId: string, text: string) =>
    request<void>('/api/send', { method: 'POST', body: JSON.stringify({ accountId, text }) }),

  personas: () => request<Persona[]>('/api/personas'),
  createPersona: (p: Omit<Persona, 'id'>) =>
    request<Persona>('/api/personas', { method: 'POST', body: JSON.stringify(p) }),
  updatePersona: (id: string, p: Omit<Persona, 'id'>) =>
    request<Persona>(`/api/personas/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  deletePersona: (id: string) => request<void>(`/api/personas/${id}`, { method: 'DELETE' }),
  previewPersona: (id: string, streamContext: string) =>
    request<{ text: string; latencyMs: number }>(`/api/personas/${id}/preview`, {
      method: 'POST',
      body: JSON.stringify({ streamContext }),
    }),

  scenarios: () => request<Scenario[]>('/api/scenarios'),
  saveScenario: (s: Scenario) =>
    request<Scenario>(`/api/scenarios/${encodeURIComponent(s.name)}`, { method: 'PUT', body: JSON.stringify(s) }),
  startScenario: (s: Scenario) =>
    request<ScenarioStatus>('/api/scenario/start', { method: 'POST', body: JSON.stringify(s) }),
  stopScenario: () => request<ScenarioStatus>('/api/scenario/stop', { method: 'POST' }),

  status: () => request<AppStatus>('/api/status'),
};
