import { useState } from 'react';
import { AlertTriangle, ArrowUpRight, Copy, ExternalLink, FolderGit2 } from 'lucide-react';
import { runtime, avatarUser, previewImageUrl, relativeTime, type SiteView } from './runtime.js';
import {
  displayStatus, monogram, siteAddress, KIND_ICON,
  STATUS_STRING, STATUS_TONE, VISIBILITY_ICON, VISIBILITY_STRING, VISIBILITY_TONE,
} from './meta.js';

/** The plate that carries the card's identity: a picture of the published page, with the address along its
 *  foot.
 *
 *  The picture is the site's own, taken by the instance through the site's published hostname and stored
 *  once per site. It is decoration with an origin — the title is the card's heading and the address is the
 *  fact a reader scans for — so it is announced to nobody. The monogram is what a card shows when there is
 *  no picture, either because none has been taken, because the capture failed before one existed, or
 *  because the browser refused the bytes: those are all the same thing to this band, and none of them is a
 *  reason to leave a rectangle blank.
 *
 *  A picture that is merely OUT OF DATE keeps its place and says so in a chip. Dropping back to a monogram
 *  on every failed refresh would make a register flicker over a page that is still perfectly well
 *  described by the picture already on screen. */
function SitePlate({ site, strings }: { site: SiteView; strings: Record<string, string> }) {
  const KindIcon = KIND_ICON[site.kind];
  const state = displayStatus(site);
  const preview = site.preview;
  // Which version the browser refused, remembered per version: a picture that failed to load once is not
  // retried on every render, and a NEW picture is given its own chance.
  const [refusedVersion, setRefusedVersion] = useState<number | null>(null);
  const picture = preview.version > 0 && refusedVersion !== preview.version;
  const frame = state === 'failed' ? 'border-destructive/40'
    : state === 'degraded' ? 'border-warning/40'
      : 'border-border/60';
  return (
    <div
      data-site-plate={state}
      data-site-preview={preview.state}
      className={`relative aspect-[16/6] w-full shrink-0 overflow-hidden rounded-lg border bg-muted/40 ${frame}`}
    >
      {picture ? (
        <img
          key={preview.version}
          src={previewImageUrl(site.id, preview.version)}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          data-site-picture={site.id}
          onError={() => setRefusedVersion(preview.version)}
          className="absolute inset-0 h-full w-full object-cover object-top"
        />
      ) : (
        <>
          {/* The monogram is the site's own initial, not an icon standing in for a picture. The bottom
              padding is the address strip's height, so the letter is centred in what is left rather than in
              a box a strip covers a third of. While a first picture is being taken it breathes, which is the
              whole of what this band has to say about a capture in progress. */}
          <span
            aria-hidden
            className={`absolute inset-0 flex select-none items-center justify-center pb-7 text-[2.75rem] font-semibold leading-none tracking-tight text-foreground/[0.09] ${preview.state === 'pending' ? 'motion-safe:animate-pulse' : ''}`}
          >
            {monogram(site.title)}
          </span>
        </>
      )}
      {/* The one caveat a picture can carry. Stated once, quietly, and only over a picture: with none, the
          card's state badge and hint already say what is wrong with the site itself. A picture merely past
          its age says nothing — the register is already taking a new one. */}
      {picture && preview.state === 'failed' ? (
        <span
          data-site-picture-state={preview.state}
          title={preview.capturedAt
            ? strings.previewCapturedAt.replace('{time}', relativeTime(preview.capturedAt))
            : undefined}
          className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-card/90 px-1.5 py-0.5 text-[10px] font-medium text-destructive backdrop-blur-sm"
        >
          <AlertTriangle size={9} aria-hidden />
          {strings.previewFailed}
        </span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 flex min-w-0 items-center gap-1.5 border-t border-border/60 bg-card/85 px-2.5 py-1.5 backdrop-blur-sm">
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

      {/* State: where the publication stands and who may open it. Which of the two publication shapes it
          is stays out of this band — the address line already carries its icon, and spelling it out a
          third time only crowds the card. */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE[state]}>{strings[STATUS_STRING[state]]}</Badge>
        <Badge tone={VISIBILITY_TONE[site.visibility]}>
          <VisibilityIcon size={10} aria-hidden className="mr-1" />
          {strings[VISIBILITY_STRING[site.visibility]]}
        </Badge>
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
