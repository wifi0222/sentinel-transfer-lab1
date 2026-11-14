export interface User { username: string; role: 'user' | 'admin' }
export interface RemoteFile { id: string; name: string; size: number; sha256: string; createdAt: string; version: number }
export interface PublicConfig { registrationEnabled: boolean; inviteRequired: boolean; maxFileBytes: number }

let accessToken = '';
let refreshPromise: Promise<boolean> | null = null;
let activeUser: User | null = null;

async function refresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) return false;
        const body = await response.json() as { accessToken: string; user: User };
        accessToken = body.accessToken;
        activeUser = body.user;
        return true;
      }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function request<T>(url: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  if (response.status === 401 && retry && await refresh()) return request<T>(url, init, false);
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? `请求失败 (${response.status})`);
  return body;
}

export async function bootstrap(): Promise<User | null> { return await refresh() ? activeUser : null; }

export async function login(username: string, password: string, register: boolean, inviteCode?: string) {
  const result = await request<{accessToken: string; user: User}>(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify({ username, password, ...(register ? { inviteCode } : {}) }) }, false);
  accessToken = result.accessToken;
  activeUser = result.user;
  return result.user;
}
export async function logout() { await request('/api/auth/logout', { method: 'POST' }).catch(() => undefined); accessToken = ''; activeUser = null; }
export async function getFiles() { return (await request<{files: RemoteFile[]}>('/api/files')).files; }
export async function deleteFile(id: string) { await request(`/api/files/${id}`, { method: 'DELETE' }); }
export async function wsTicket() { return (await request<{ticket: string}>('/api/ws-ticket', { method: 'POST' })).ticket; }
export async function getPublicConfig() { return request<PublicConfig>('/api/config', {}, false); }
export async function changePassword(currentPassword: string, newPassword: string) {
  const result = await request<{accessToken: string; user: User}>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
  accessToken = result.accessToken; activeUser = result.user; return result.user;
}
export async function logoutAll() { await request('/api/auth/logout-all', { method: 'POST' }); accessToken = ''; activeUser = null; }

