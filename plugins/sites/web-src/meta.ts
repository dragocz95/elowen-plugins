import { AlertTriangle, CircleDashed, CircleDot, FolderGit2, Globe, Lock, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SiteStatus, SiteView, Visibility } from './runtime.js';

/** How a site's access and lifecycle are labelled everywhere on this page. The tables live here rather
 *  than in a view so the register, the drawer and the visibility dropdown cannot drift into three
 *  slightly different vocabularies for the same four values. */

export const VISIBILITY_ORDER: readonly Visibility[] = ['private', 'project', 'authenticated', 'public'];

export const VISIBILITY_STRING: Record<Visibility, string> = {
  private: 'visibilityPrivate',
  project: 'visibilityProject',
  authenticated: 'visibilityAuthenticated',
  public: 'visibilityPublic',
};

export const VISIBILITY_ICON: Record<Visibility, LucideIcon> = {
  private: Lock,
  project: FolderGit2,
  authenticated: Users,
  public: Globe,
};

/** Authenticated access is intentionally distinct from project/private scope; public widens readership
 *  beyond the instance and therefore keeps the warning tone. */
export const VISIBILITY_TONE: Record<Visibility, 'muted' | 'accent' | 'warning'> = {
  private: 'muted',
  project: 'muted',
  authenticated: 'accent',
  public: 'warning',
};

export type DisplayStatus = SiteStatus | 'degraded';

export const displayStatus = (site: Pick<SiteView, 'status' | 'degraded'>): DisplayStatus =>
  site.degraded ? 'degraded' : site.status;

export const STATUS_ORDER: readonly DisplayStatus[] = ['live', 'degraded', 'draft', 'failed'];

export const STATUS_STRING: Record<DisplayStatus, string> = {
  live: 'statusLive',
  degraded: 'statusDegraded',
  draft: 'statusDraft',
  failed: 'statusFailed',
};

export const STATUS_ICON: Record<DisplayStatus, LucideIcon> = {
  live: CircleDot,
  degraded: AlertTriangle,
  draft: CircleDashed,
  failed: AlertTriangle,
};

export const STATUS_TONE: Record<DisplayStatus, 'success' | 'warning' | 'muted' | 'danger'> = {
  live: 'success',
  degraded: 'warning',
  draft: 'muted',
  failed: 'danger',
};
