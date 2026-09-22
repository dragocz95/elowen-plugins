/** The appearance editor: how a chatbot's panel looks, with a live preview beside the controls.
 *
 *  It is built around one value — a `ChatbotAppearance` — which is the SAME shape the server stores and the
 *  widget draws from (appearanceContract.ts). Every control edits that value and nothing else, and the
 *  preview renders it as it changes; nothing here keeps a second copy of a colour or invents a style of its
 *  own. Saving sends the whole value, so what is stored is exactly what was being previewed.
 *
 *  The name is edited here too, because a customer configuring how their chatbot looks is configuring the
 *  name it is introduced by. It is the chatbot's ONE name — the same `display_name` the register shows — so
 *  this editor writes that column and stores no second copy of it in the appearance document. */

import { useEffect, useState, type ChangeEvent } from 'react';
import { MousePointerClick, Palette, Plus, Ruler, Save, Trash2 } from 'lucide-react';
import {
  APPEARANCE_BOUNDS,
  APPEARANCE_INTRO_MAX_CHARS,
  APPEARANCE_QUICK_BUTTONS_MAX,
  APPEARANCE_QUICK_BUTTON_MAX_CHARS,
  APPEARANCE_AVATAR_URL_MAX_CHARS,
  presetAppearance,
  type AppearanceMode,
  type ChatbotAppearance,
} from '../src/appearanceContract';
import { apiJson, jsonRequest, runtime } from './runtime';
import type { ChatbotBotView } from './types';
import { AppearancePreview } from './AppearancePreview';

/** A hint for the form, never the rule: the server parses every address it is given and refuses one it
 *  cannot reduce to an https address or an image, so this only keeps an obviously wrong value out of a save
 *  and explains itself next to the field. */
export function avatarHint(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('data:')) return /^data:image\/[a-z0-9.+-]+[;,]/.test(trimmed) ? null : 'invalid';
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? null : 'invalid';
  } catch {
    return 'invalid';
  }
}

/** A quick button the list already holds is one a visitor can only be confused by; the server collapses the
 *  duplicates, and this keeps the second one out of the list in the first place. */
export function quickButtonHint(value: string, existing: string[]): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return existing.includes(trimmed) ? 'duplicate' : null;
}

const COLOR_FIELDS = ['panel', 'visitorBubble', 'botBubble', 'sendButton'] as const;
type ColorField = (typeof COLOR_FIELDS)[number];

export function AppearanceModal({ bot, onClose, onChanged }: {
  bot: ChatbotBotView;
  onClose(): void;
  /** The saved row, back from the server: the register shows the new name and the next save compares
   *  against the new `updatedAt`. */
  onChanged(bot: ChatbotBotView): void;
}) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { toast } = hooks.useToast();
  const [name, setName] = useState(bot.displayName);
  const [appearance, setAppearance] = useState<ChatbotAppearance>(bot.appearance);
  const [draftButton, setDraftButton] = useState('');
  const [revision, setRevision] = useState(bot.updatedAt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A different chatbot is a different form, so it starts from that chatbot's values with nothing open. A
  // save does NOT re-seed it: the row it comes back with is the row this editor just wrote, and re-seeding
  // would throw away an edit made while the request was in flight.
  useEffect(() => {
    setName(bot.displayName);
    setAppearance(bot.appearance);
    setRevision(bot.updatedAt);
    setDraftButton('');
    setError(null);
  }, [bot.chatbotUserId]);

  const patch = (part: Partial<ChatbotAppearance>) => setAppearance((current) => ({ ...current, ...part }));
  const setColor = (field: ColorField, value: string) => setAppearance((current) => ({ ...current, colors: { ...current.colors, [field]: value } }));
  const pixels = (value: number) => s.appearancePixels.replace('{value}', String(value));
  const maxChars = (limit: number) => s.appearanceMaxChars.replace('{max}', String(limit));

  const avatar = avatarHint(appearance.avatarUrl);
  const buttonHint = quickButtonHint(draftButton, appearance.quickButtons);
  const quickFull = appearance.quickButtons.length >= APPEARANCE_QUICK_BUTTONS_MAX;

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const answer = await apiJson<{ bot: ChatbotBotView }>('/plugins/chatbot/api/appearance', jsonRequest('PUT', {
        chatbotUserId: bot.chatbotUserId,
        expectedUpdatedAt: revision,
        displayName: name,
        appearance,
      }));
      setRevision(answer.bot.updatedAt);
      onChanged(answer.bot);
      toast(s.appearanceSaved);
    } catch (reason) {
      setError(utils.apiErrorMessage(reason) || s.appearanceSaveFailed);
    } finally {
      setPending(false);
    }
  };

  const addButton = () => {
    if (buttonHint !== null) return;
    const label = draftButton.trim();
    setAppearance((current) => ({ ...current, quickButtons: [...current.quickButtons, label] }));
    setDraftButton('');
  };

  const colorLabels: Record<ColorField, string> = {
    panel: s.appearanceColorPanel,
    visitorBubble: s.appearanceColorVisitor,
    botBubble: s.appearanceColorBot,
    sendButton: s.appearanceColorSend,
  };

  return (
    <C.Modal
      title={s.appearanceTitle}
      description={s.appearanceIntro}
      icon={Palette}
      size="lg"
      presentation="center"
      closeLabel={s.cancel}
      closeDisabled={pending}
      {...(pending ? { 'aria-busy': true as const } : {})}
      onClose={onClose}
    >
      <C.ModalBody>
        {/* The preview comes FIRST on a narrow screen: it is the thing being configured, and a reader who
            has to scroll past a dozen controls to reach it has no way to see what they are doing. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:items-start">
          <div className="order-2 flex min-w-0 flex-col gap-5 lg:order-1">
            <C.Field label={s.appearanceNameLabel} hint={s.appearanceNameHint}>
              <C.Input
                value={name}
                maxLength={80}
                disabled={pending}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
              />
            </C.Field>

            {/* Mode and corner side by side: two short choices that used to take two full-width rows. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <C.Field label={s.appearanceModeLabel} hint={s.appearanceModeHint}>
                <C.Segmented
                  aria-label={s.appearanceModeLabel}
                  value={appearance.mode}
                  // The mode IS its colour set: switching it puts that set in the pickers below, which is what
                  // makes "light or dark" one click rather than four. Every colour stays editable afterwards.
                  onChange={(mode: string) => setAppearance(presetAppearance(mode as AppearanceMode))}
                  options={[
                    { value: 'light', label: s.appearanceModeLight },
                    { value: 'dark', label: s.appearanceModeDark },
                  ]}
                />
              </C.Field>

              <C.Field label={s.appearancePositionLabel}>
                <C.SelectMenu
                  label={s.appearancePositionLabel}
                  value={appearance.position}
                  onChange={(position: string) => patch({ position: position as ChatbotAppearance['position'] })}
                  options={[
                    { value: 'bottom-right', label: s.appearancePositionBottomRight },
                    { value: 'bottom-left', label: s.appearancePositionBottomLeft },
                    { value: 'top-right', label: s.appearancePositionTopRight },
                    { value: 'top-left', label: s.appearancePositionTopLeft },
                  ]}
                />
              </C.Field>
            </div>

            {/* The four colours as four records of the host's own section card: a label opposite its
                control, which is what this was imitating with a bordered label of its own. */}
            <C.SettingsGroup title={s.appearanceColorsLabel} icon={Palette} columns={2} density="compact">
              {COLOR_FIELDS.map((field) => (
                <C.SettingsRow
                  key={field}
                  label={colorLabels[field]}
                  status={<span className="font-mono text-[11px] uppercase">{appearance.colors[field]}</span>}
                  control={(
                    <input
                      type="color"
                      aria-label={colorLabels[field]}
                      value={appearance.colors[field]}
                      disabled={pending}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => setColor(field, event.target.value)}
                      className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent p-0"
                    />
                  )}
                />
              ))}
            </C.SettingsGroup>

            {/* The three scalars as three records, each one line: the slider opposite its name with the
                value it is at, instead of a stacked field per number. */}
            <C.SettingsGroup title={s.appearanceSizeLabel} icon={Ruler} density="compact">
              <C.SettingsRow
                label={s.appearanceRadiusLabel}
                status={<span className="font-mono text-[11px]">{pixels(appearance.radius)}</span>}
                control={(
                  <C.Slider
                    value={appearance.radius}
                    min={APPEARANCE_BOUNDS.radius.min}
                    max={APPEARANCE_BOUNDS.radius.max}
                    step={1}
                    aria-label={s.appearanceRadiusLabel}
                    onChange={(value: number) => patch({ radius: value })}
                  />
                )}
              />
              <C.SettingsRow
                label={s.appearanceWidthLabel}
                status={<span className="font-mono text-[11px]">{pixels(appearance.width)}</span>}
                control={(
                  <C.Slider
                    value={appearance.width}
                    min={APPEARANCE_BOUNDS.width.min}
                    max={APPEARANCE_BOUNDS.width.max}
                    step={10}
                    aria-label={s.appearanceWidthLabel}
                    onChange={(value: number) => patch({ width: value })}
                  />
                )}
              />
              <C.SettingsRow
                label={s.appearanceHeightLabel}
                status={<span className="font-mono text-[11px]">{pixels(appearance.height)}</span>}
                control={(
                  <C.Slider
                    value={appearance.height}
                    min={APPEARANCE_BOUNDS.height.min}
                    max={APPEARANCE_BOUNDS.height.max}
                    step={10}
                    aria-label={s.appearanceHeightLabel}
                    onChange={(value: number) => patch({ height: value })}
                  />
                )}
              />
            </C.SettingsGroup>

            <C.Field label={s.appearanceIntroLabel} hint={`${s.appearanceIntroHint} ${maxChars(APPEARANCE_INTRO_MAX_CHARS)}`}>
              <textarea
                value={appearance.intro ?? ''}
                rows={3}
                maxLength={APPEARANCE_INTRO_MAX_CHARS}
                disabled={pending}
                placeholder={s.appearanceIntroPlaceholder}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => patch({ intro: event.target.value === '' ? null : event.target.value })}
                className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
              />
            </C.Field>

            <C.Field label={s.appearanceAvatarLabel} hint={`${s.appearanceAvatarHint} ${maxChars(APPEARANCE_AVATAR_URL_MAX_CHARS)}`}>
              <C.Input
                value={appearance.avatarUrl}
                maxLength={APPEARANCE_AVATAR_URL_MAX_CHARS}
                disabled={pending}
                placeholder={s.appearanceAvatarPlaceholder}
                onChange={(event: ChangeEvent<HTMLInputElement>) => patch({ avatarUrl: event.target.value })}
              />
            </C.Field>
            {avatar === 'invalid' ? <p className="text-xs text-destructive">{s.appearanceAvatarInvalid}</p> : null}

            <C.SettingsGroup
              title={s.appearanceQuickLabel}
              description={`${s.appearanceQuickHint} ${maxChars(APPEARANCE_QUICK_BUTTON_MAX_CHARS)}`}
              icon={MousePointerClick}
            >
              {appearance.quickButtons.length === 0 ? (
                <p className="text-xs text-muted-foreground">{s.appearanceQuickEmpty}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {appearance.quickButtons.map((text) => (
                    <li key={text} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-foreground">{text}</span>
                      <C.IconButton
                        icon={Trash2}
                        variant="danger"
                        label={s.appearanceQuickRemove.replace('{value}', text)}
                        disabled={pending}
                        onClick={() => patch({ quickButtons: appearance.quickButtons.filter((candidate) => candidate !== text) })}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <C.Field label={s.appearanceQuickAdd}>
                  <C.Input
                    value={draftButton}
                    maxLength={APPEARANCE_QUICK_BUTTON_MAX_CHARS}
                    disabled={pending}
                    placeholder={s.appearanceQuickPlaceholder}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setDraftButton(event.target.value)}
                  />
                </C.Field>
                <C.Button icon={Plus} disabled={pending || draftButton.trim() === '' || buttonHint !== null || quickFull} onClick={addButton}>
                  {s.appearanceQuickAdd}
                </C.Button>
              </div>
              {buttonHint === 'duplicate' ? <p className="text-xs text-destructive">{s.appearanceQuickDuplicate}</p> : null}
              {quickFull ? <p className="text-xs text-muted-foreground">{s.appearanceQuickFull}</p> : null}
            </C.SettingsGroup>
          </div>

          <div className="order-1 min-w-0 lg:order-2 lg:sticky lg:top-0">
            <AppearancePreview look={{ name, appearance }} label={s.appearancePreview} hint={s.appearancePreviewHint} />
          </div>
        </div>
      </C.ModalBody>
      <C.ModalFooter>
        {error !== null ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        <C.Button variant="ghost" disabled={pending} onClick={onClose}>{s.cancel}</C.Button>
        <C.Button
          variant="accent"
          icon={Save}
          disabled={pending || name.trim() === '' || avatar === 'invalid'}
          onClick={() => void save()}
        >
          {pending ? s.appearanceSaving : s.appearanceSave}
        </C.Button>
      </C.ModalFooter>
    </C.Modal>
  );
}
