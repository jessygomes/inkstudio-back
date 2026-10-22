import { BadGatewayException, Injectable } from '@nestjs/common';
import { requiredInstagramEnv } from './instagram-security';

type MetaError = { error?: { message?: string; code?: number } };
type TokenResponse = { access_token: string; user_id?: number | string; expires_in?: number };
export type InstagramProfile = { id: string; user_id?: string | number; username?: string; account_type?: string };
export type InstagramContactProfile = { id?: string; username?: string; name?: string; profile_pic?: string };

@Injectable()
export class InstagramApiService {
  private get version(): string {
    const version = process.env.INSTAGRAM_GRAPH_VERSION || 'v25.0';
    if (!/^v\d+\.\d+$/.test(version)) throw new BadGatewayException('Version de l’API Instagram invalide');
    return version;
  }

  private async request<T>(url: string, init: RequestInit = {}, timeoutMs = 12000): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new BadGatewayException('Instagram est temporairement inaccessible');
    }
    const payload = await response.json().catch(() => ({})) as T & MetaError;
    if (!response.ok || payload.error) {
      // Ne jamais remonter le corps complet (ni les URL contenant un token) au navigateur.
      throw new BadGatewayException(`Instagram a refusé la requête (HTTP ${response.status}${payload.error?.code ? `, code ${payload.error.code}` : ''})`);
    }
    return payload;
  }

  buildAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: requiredInstagramEnv('INSTAGRAM_APP_ID'),
      redirect_uri: requiredInstagramEnv('INSTAGRAM_OAUTH_REDIRECT_URI'),
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_manage_messages',
      state,
      force_reauth: 'true',
    });
    return `https://www.instagram.com/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string): Promise<TokenResponse> {
    const params = new URLSearchParams({
      client_id: requiredInstagramEnv('INSTAGRAM_APP_ID'),
      client_secret: requiredInstagramEnv('INSTAGRAM_APP_SECRET'),
      grant_type: 'authorization_code',
      redirect_uri: requiredInstagramEnv('INSTAGRAM_OAUTH_REDIRECT_URI'),
      code,
    });
    return this.request<TokenResponse>('https://api.instagram.com/oauth/access_token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params,
    });
  }

  async exchangeLongLivedToken(accessToken: string): Promise<TokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: requiredInstagramEnv('INSTAGRAM_APP_SECRET'),
      access_token: accessToken,
    });
    return this.request<TokenResponse>(`https://graph.instagram.com/access_token?${params}`);
  }

  async refreshToken(accessToken: string): Promise<TokenResponse> {
    const params = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: accessToken });
    return this.request<TokenResponse>(`https://graph.instagram.com/refresh_access_token?${params}`);
  }

  async profile(accessToken: string): Promise<InstagramProfile> {
    const headers = { Authorization: `Bearer ${accessToken}` };
    try {
      return await this.request<InstagramProfile>('https://graph.instagram.com/me?fields=id,user_id,username,account_type', { headers });
    } catch (error) {
      // Certaines versions ne reconnaissent pas `user_id`.
      if (!(error instanceof BadGatewayException)) throw error;
      return this.request<InstagramProfile>('https://graph.instagram.com/me?fields=id,username,account_type', { headers });
    }
  }

  async contactProfile(accessToken: string, id: string): Promise<InstagramContactProfile> {
    return this.request<InstagramContactProfile>(`https://graph.instagram.com/${this.version}/${encodeURIComponent(id)}?fields=name,username,profile_pic`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, 1800);
  }

  async subscribeMessages(accessToken: string): Promise<void> {
    const result = await this.request<{ success?: boolean | string }>(`https://graph.instagram.com/${this.version}/me/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ subscribed_fields: 'messages' }),
    });
    if (result.success !== true && result.success !== 'true') {
      throw new BadGatewayException('Instagram n’a pas confirmé l’abonnement aux Webhooks');
    }
  }

  async sendMessage(accountId: string, recipientId: string, accessToken: string, message: object): Promise<string> {
    const result = await this.request<{ message_id?: string }>(`https://graph.instagram.com/${this.version}/${encodeURIComponent(accountId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message }),
    });
    if (!result.message_id) throw new BadGatewayException('Instagram n’a pas confirmé l’envoi du message');
    return result.message_id;
  }
}
