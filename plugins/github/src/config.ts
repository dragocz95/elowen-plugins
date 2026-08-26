import type { PluginContext } from 'elowen/plugin-api';
import type { GitHubPluginConfig } from './types.js';
import { GitHubPluginError } from './errors.js';

export function pluginConfig(ctx: PluginContext): GitHubPluginConfig {
  return {
    clientId: typeof ctx.config.clientId === 'string' ? ctx.config.clientId.trim() : '',
    appSlug: typeof ctx.config.appSlug === 'string' ? ctx.config.appSlug.trim() : '',
  };
}

export function callbackUrl(ctx: PluginContext): string {
  const publicUrl = ctx.publicWebUrl();
  if (!publicUrl) throw new GitHubPluginError('public_url_missing', 503, 'A canonical public web URL is required before GitHub can be connected.');
  return `${publicUrl}/api/plugins/github/api/auth/callback`;
}

export function requireAppSetup(ctx: PluginContext): GitHubPluginConfig & { clientSecret: string; redirectUri: string } {
  const config = pluginConfig(ctx);
  const secret = ctx.instanceSecrets().get('client-secret')?.value ?? '';
  if (!config.clientId || !config.appSlug || !secret) {
    throw new GitHubPluginError('app_not_configured', 503, 'The GitHub App client ID, app slug and client secret must be configured by an administrator.');
  }
  return { ...config, clientSecret: secret, redirectUri: callbackUrl(ctx) };
}
