import { ArrowUpRight, Copy, ExternalLink, FolderGit2 } from 'lucide-react';
import { runtime, avatarUser, relativeTime, type SiteView } from './runtime.js';
import {
  displayStatus, monogram, siteAddress, KIND_ICON, KIND_STRING,
  STATUS_STRING, STATUS_TONE, VISIBILITY_ICON, VISIBILITY_STRING, VISIBILITY_TONE,
} from './meta.js';

/** The plate that carries the card's identity.
 *
 *  This band is reserved for a cached picture of the published page, which this instance cannot take: no
 *  maintained screenshot seam is offered to a plugin, and the plate deliberately does NOT imitate one.
 *  What it shows instead is true and is the fact a reader scans a register of published pages for — the
 *  address — over a monogram taken from the site's own title, so a grid of cards is distinguishable at a
 *  glance rather than a column of identical rectangles.
 *
 *  The address strip sits on the card's own ground with a border above it, so it stays legible under every
 *  skin without a scrim: nothing behind it is an image whose brightness could be anything. */
function SitePlate({ site, strings }: { site: SiteView; strings: Record<string, string> }) {
  const KindIcon = KIND_ICON[site.kind];
  const state = displayStatus(site);
  const frame = state === 'failed' ? 'border-destructive/40'
    : state === 'degraded' ? 'border-warning/40'
      : 'border-border/60';
  return (
    <div
      data-site-plate={state}
      className={`relative aspect-[16/6] w-full shrink-0 overflow-hidden rounded-lg border bg-muted/40 ${frame}`}
    >
      {/* The monogram is the site's own initial, not an icon standing in for a picture. It is decoration
          with an origin, so it never announces itself: the title is already the card's heading. The
          bottom padding is the address strip's height, so the letter is centred in what is left rather
          than in a box a strip covers a third of. */}
      <span
        aria-hidden
        className="absolute inset-0 flex select-none items-center justify-center pb-7 text-[2.75rem] font-semibold leading-none tracking-tight text-foreground/[0.09]"
      >
        {monogram(site.title)}
      </span>
      <span className="absolute inset-x-0 bottom-0 flex min-w-0 items-center gap-1.5 border-t border-border/60 bg-card/85 px-2.5 py-1.5">
        <KindIcon size={11} aria-hidden className="shrink-0 text-muted-foreground" />
        {site.url === null ? (
          // A draft has no address yet, and the slug it would get is not one. Saying so is the whole
          // content of the strip; printing the slug beside it only invites someone to try it.
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">{strings.noAddress}</span>
        ) : (
          <code className="min-w-0 truncate font-mono text-[11px] text-foreground" title={site.url}>
            {siteAddress(site)}
          </code>
        )}
      </span>
    </div>
  );
}

/** One published site, as a card in the register.
 *
 *  The card is NOT a button. It carries a heading, two address actions and its own open control, and a
 *  button wrapping all of that is a control containing controls. The quiet surface opens the detail on
 *  click — that is the pointer affordance — while the footer's open control is the card's single tab stop
 *  and the keyboard path, exactly as the Projects register does it. */
export function SiteCard({ site, strings, selected, onOpen, onNavigate }: {
  site: SiteView;
  strings: Record<string, string>;
  selected: boolean;
  onOpen(): void;
  onNavigate(direction: 'next' | 'previous' | 'home' | 'end'): void;
}) {
  const { components, hooks, utils } = runtime();
  const { Avatar, Badge, IconButton } = components;
  const { toast } = hooks.useToast();

  const state = displayStatus(site);
  const VisibilityIcon = VISIBILITY_ICON[site.visibility];
  const published = site.lastPublishAt ? relativeTime(site.lastPublishAt) : strings.neverPublished;
  // The list response carries no stored failure — that is disclosed to a manager in the drawer only — so
  // the card says what the derived state means and where the reason is, and never guesses at it.
  const hint = state === 'degraded' ? strings.stateHintDegraded
    : state === 'failed' ? strings.stateHintFailed
      : null;
  const openLabel = strings.openDetail.replace('{title}', site.title);

  return (
    <div
      data-site-card={site.id}
      data-selected={selected ? 'true' : undefined}
      aria-current={selected ? 'true' : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 'next'
          : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? 'previous'
            : event.key === 'Home' ? 'home'
              : event.key === 'End' ? 'end' : null;
        if (!direction) return;
        event.preventDefault();
        onNavigate(direction);
      }}
      className={`group flex h-full min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-3.5 transition-colors ${selected ? 'border-primary/60 bg-primary/[0.055]' : 'border-border hover:border-primary/40'}`}
    >
      <SitePlate site={site} strings={strings} />

      {/* Identity. The title is the heading; the address is on the plate and is not repeated here. */}
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="min-w-0 truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary" title={site.title}>
            {site.title}
          </h3>
          {site.summary ? (
            <p className="min-w-0 truncate text-xs leading-tight text-muted-foreground" title={site.summary}>{site.summary}</p>
          ) : null}
        </div>
        {/* The two things anybody does with an address. They sit inside a card that opens on click, so
            each one stops the event: copying an address is not asking for the drawer. */}
        <span className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
          <IconButton
            icon={Copy}
            label={strings.copyLink}
            disabled={site.url === null}
            onClick={() => { if (site.url) { utils.copyText(site.url); toast(strings.copied); } }}
          />
          <IconButton
            icon={ExternalLink}
            label={strings.openSite}
            disabled={site.status !== 'live' || site.url === null}
            onClick={() => { if (site.url) window.open(site.url, '_blank', 'noopener,noreferrer'); }}
          />
        </span>
      </div>

      {/* State. Lifecycle, who may open it and which of the two publications it is — each said once. */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE[state]}>{strings[STATUS_STRING[state]]}</Badge>
        <Badge tone={VISIBILITY_TONE[site.visibility]}>
          <VisibilityIcon size={10} aria-hidden className="mr-1" />
          {strings[VISIBILITY_STRING[site.visibility]]}
        </Badge>
        <Badge tone={site.kind === 'proxy' ? 'accent' : 'muted'}>{strings[KIND_STRING[site.kind]]}</Badge>
      </div>

      {hint ? (
        <p className={`min-w-0 text-[11px] leading-tight text-balance ${state === 'failed' ? 'text-destructive' : 'text-warning'}`}>{hint}</p>
      ) : null}

      {/* Who owns it and which Project it belongs to. `mt-auto` keeps the footer on the card's floor, so a
          grid of cards of uneven height still lines its footers up. */}
      <div className="mt-auto flex min-w-0 items-center gap-2">
        <Avatar size={22} name={site.owner.name} user={avatarUser(site.owner)} />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={site.owner.name}>{site.owner.name}</span>
        {site.projectSlug ? (
          <span
            className="flex min-w-0 shrink items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] leading-5 text-muted-foreground"
            title={`${strings.project}: ${site.projectSlug}`}
          >
            <FolderGit2 size={11} aria-hidden className="shrink-0" />
            <span className="min-w-0 truncate">{site.projectSlug}</span>
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-2 border-t border-border/70 pt-2.5">
        <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={`${strings.lastPublish}: ${published}`}>
          {published}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          data-site-open={site.id}
          aria-label={openLabel}
          onClick={(event) => { event.stopPropagation(); onOpen(); }}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
        >
          {strings.openDetailShort}
          <ArrowUpRight size={12} aria-hidden />
        </button>
      </div>
    </div>
  );
}
