/** Edits a linked template and explicit overrides. The chatbot's name stays in its own column. */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { MousePointerClick, Palette, Plus, RotateCcw, Ruler, Trash2, Type, UserRound, Send, Volume2, Sparkles } from 'lucide-react';
import {
  APPEARANCE_BOUNDS, APPEARANCE_ICONS, APPEARANCE_TEMPLATE_IDS, APPEARANCE_TEMPLATES,
  APPEARANCE_INTRO_MAX_CHARS, APPEARANCE_AVATAR_URL_MAX_CHARS, APPEARANCE_SUBTITLE_MAX_CHARS,
  APPEARANCE_PLACEHOLDER_MAX_CHARS, APPEARANCE_LAUNCHER_LABEL_MAX_CHARS,
  APPEARANCE_QUICK_BUTTONS_MAX, APPEARANCE_QUICK_BUTTON_MAX_CHARS, APPEARANCE_TEASER_MAX_CHARS,
  APPEARANCE_FONT_STACKS, APPEARANCE_SHADOWS, appearanceRamp,
  appearanceIcon, appearanceInk, isAppearanceOverridden, parseAppearanceSelection,
  resetAppearanceOverride, resolveAppearance, selectAppearanceTemplate, setAppearanceOverride,
  type AppearanceIconId, type AppearanceOverridePath, type AppearanceTemplateId, type StoredAppearance,
} from '../src/appearanceContract';
import { DISPLAY_NAME_MAX_CHARS } from '../src/adminContract';
import { apiJson, jsonRequest, runtime } from './runtime';
import type { ChatbotBotView } from './types';
import { AppearancePreview } from './AppearancePreview';
import { playTone, unlockSound } from '../embed-src/sound';

function Icon({ id }: { id: AppearanceIconId }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={appearanceIcon(id).path} /></svg>;
}

/** Small visual swatches use the contract's actual fills, geometry and glyphs. */
function TemplateSwatch({ template }: { template: AppearanceTemplateId }) {
  const a = APPEARANCE_TEMPLATES[template];
  const ramp = appearanceRamp(a);
  return <span aria-hidden className="flex h-28 w-full flex-col gap-2 p-2" style={{ background: a.colors.panel, borderRadius: a.radius / 2, border: `1px solid ${ramp.border}` }}>
    <span className="flex w-full rounded p-1.5" style={{ background: ramp.header }}><span className="h-2 w-1/2 rounded" style={{ background: ramp.headerInk }} /></span>
    <span className="h-4 w-3/4 self-start" style={{ background: a.colors.botBubble, borderRadius: a.radius / 3 }} />
    <span className="h-4 w-1/2 self-end" style={{ background: a.colors.visitorBubble, borderRadius: a.radius / 3 }} />
    <span className="mt-auto flex justify-end gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: a.colors.launcher, color: appearanceInk(a.colors.launcher), border: `1px solid ${ramp.launcherBorder}` }}><Icon id={a.launcher.icon} /></span>
      <span className="flex h-6 w-6 items-center justify-center" style={{ background: a.colors.sendButton, color: a.colors.sendIcon, borderRadius: a.send.shape === 'circle' ? '50%' : 4 }}><Icon id={a.send.icon} /></span>
    </span>
  </span>;
}

export function AppearanceModal({ bot, onClose, onChanged }: {
  bot: ChatbotBotView;
  onClose(): void;
  onChanged(bot: ChatbotBotView): void;
}) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const { toast } = hooks.useToast();
  const id = useId();
  const [name, setName] = useState(bot.displayName);
  const [stored, setStored] = useState<StoredAppearance>(bot.appearance);
  const [draftButton, setDraftButton] = useState('');
  const [draftIcon, setDraftIcon] = useState<AppearanceIconId | null>(null);
  const [templateChoice, setTemplateChoice] = useState<AppearanceTemplateId | null>(null);
  const [revision, setRevision] = useState(bot.updatedAt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState(0);
  const appearance = useMemo(() => resolveAppearance(stored), [stored]);
  const look = useMemo(() => ({ name, appearance }), [name, appearance]);

  const patch = (path: AppearanceOverridePath, value: unknown) => {
    setStored(current => setAppearanceOverride(current, path, value));
    setEditVersion(version => version + 1);
  };
  const reset = (path: AppearanceOverridePath, label: string, compact = false) => {
    if (!isAppearanceOverridden(stored, path)) return null;
    const title = s.appearanceReset.replace('{value}', label);
    const onClick = () => {
      setStored(current => resetAppearanceOverride(current, path));
      setEditVersion(version => version + 1);
    };
    return compact
      ? <C.IconButton icon={RotateCcw} disabled={pending} label={title} onClick={onClick} />
      : <C.Button variant="ghost" size="sm" icon={RotateCcw} disabled={pending} aria-label={title} onClick={onClick}>{s.appearanceOverridden}</C.Button>;
  };
  const heading = (path: AppearanceOverridePath, label: string, help?: string) => <div className="flex flex-wrap items-center justify-between gap-1">
    <label htmlFor={`${id}-${path}`} className="text-sm font-medium text-foreground">{label}</label>
    <span className="flex items-center gap-1">{help ? <C.HelpTip>{help}</C.HelpTip> : null}{reset(path, label)}</span>
  </div>;
  const field = (path: AppearanceOverridePath, label: string, control: ReactNode, help?: string) => <div className="flex min-w-0 flex-col gap-2">{heading(path, label, help)}{control}</div>;
  const textField = (path: AppearanceOverridePath, label: string, value: string, max: number, placeholder?: string, help?: string) =>
    field(path, label, <C.Input id={`${id}-${path}`} aria-label={label} value={value} maxLength={max} disabled={pending} placeholder={placeholder} onChange={event => patch(path, event.target.value)} />, help);
  const select = (path: AppearanceOverridePath, label: string, value: string, options: { value: string; label: string; icon?: ReactNode }[]) =>
    field(path, label, <C.SelectMenu label={label} value={value} options={options} disabled={pending} onChange={value => patch(path, value)} />);
  const icons = APPEARANCE_ICONS.map(icon => ({ value: icon.id, label: s[`appearanceIcon_${icon.id}`], icon: <Icon id={icon.id} /> }));
  const iconPicker = (path: 'send.icon' | 'launcher.icon', label: string, value: AppearanceIconId) => select(path, label, value, icons);
  const colorControl = (path: AppearanceOverridePath, label: string, value: string, help?: string) => field(path, label,
    <input id={`${id}-${path}`} type="color" aria-label={label} value={value} disabled={pending} onChange={event => patch(path, event.target.value)} className="h-9 w-full cursor-pointer rounded border border-border bg-transparent p-1" />, help);
  const color = (key: 'panel' | 'header' | 'visitorBubble' | 'botBubble' | 'sendButton' | 'sendIcon' | 'launcher', label: string) => colorControl(`colors.${key}`, label, appearance.colors[key] ?? appearanceRamp(appearance).header);
  const gradientEnd = (key: 'visitorBubbleEnd' | 'headerEnd' | 'launcherEnd', label: string, start: string) => <div className="flex min-w-0 flex-col gap-2">
    {heading(`colors.${key}`, label)}
    <div className="flex items-center gap-2 text-sm"><input type="color" aria-label={label} value={appearance.colors[key] ?? start} disabled={pending} onChange={event => patch(`colors.${key}`, event.target.value)} className="h-9 min-w-0 flex-1 cursor-pointer rounded border border-border bg-transparent p-1" />
      <C.Button variant="outline" size="sm" aria-label={`${label}: ${s.appearanceSolid}`} disabled={pending || appearance.colors[key] === null} onClick={() => patch(`colors.${key}`, null)}>{s.appearanceSolid}</C.Button></div>
  </div>;
  const scalar = (path: AppearanceOverridePath, key: keyof typeof APPEARANCE_BOUNDS, label: string, value: number) => {
    const text = s.appearancePixels.replace('{value}', String(value));
    return <div className="py-2">
      <div className="flex items-center gap-2.5">
        <Ruler size={18} aria-hidden className="shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium text-foreground"><span className="truncate" title={label}>{label}</span><C.HelpTip>{s[`appearanceHint_${key}`]}</C.HelpTip></span>
        <span className="shrink-0 font-mono text-sm tabular-nums text-primary">{text}</span>
        {reset(path, label, true)}
      </div>
      <C.Slider className="mt-3" value={value} {...APPEARANCE_BOUNDS[key]} step={1} disabled={pending} aria-label={label} aria-valuetext={text} onChange={value => patch(path, value)} />
    </div>;
  };
  const metric = (path: AppearanceOverridePath, key: keyof typeof APPEARANCE_BOUNDS, label: string, value: number, suffix: string) => <div className="py-2">
    <div className="flex items-center gap-2 text-sm font-medium text-foreground"><span className="min-w-0 flex-1">{label}</span><span className="font-mono tabular-nums text-primary">{value} {suffix}</span>{reset(path, label, true)}</div>
    <C.Slider className="mt-3" value={value} {...APPEARANCE_BOUNDS[key]} step={1} disabled={pending} aria-label={label} onChange={value => patch(path, value)} />
  </div>;
  const toggle = (path: 'header.showAvatar' | 'header.showMessageName' | 'launcher.presenceDot' | 'launcher.ring' | 'launcher.unreadBadge' | 'effects.glass', label: string, checked: boolean, help?: string) =>
    field(path, label, <C.Toggle label={label} checked={checked} disabled={pending} onChange={value => patch(path, value)} />, help);
  const section = (label: string, icon: ReactNode, children: ReactNode, help?: string, action?: ReactNode) => <section className="flex min-w-0 flex-col gap-4 border-t border-border pt-4">
    <div className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">{icon}</span><h3 className="text-sm font-semibold text-foreground">{label}</h3>{help ? <C.HelpTip>{help}</C.HelpTip> : null}{action}</div>{children}
  </section>;

  const buttonText = draftButton.trim();
  const duplicate = appearance.quickButtons.some(button => button.text === buttonText);
  const quickFull = appearance.quickButtons.length >= APPEARANCE_QUICK_BUTTONS_MAX;
  const addButton = () => {
    if (pending || quickFull || duplicate || !buttonText) return;
    patch('quickButtons', [...appearance.quickButtons, { text: buttonText, icon: draftIcon }]);
    setDraftButton('');
  };
  const valid = parseAppearanceSelection(stored).ok;
  const save = async (): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      const answer = await apiJson<{ bot: ChatbotBotView }>('/plugins/chatbot/api/appearance', jsonRequest('PUT', {
        chatbotUserId: bot.chatbotUserId, expectedUpdatedAt: revision, displayName: name, appearance: stored,
      }));
      setRevision(answer.bot.updatedAt);
      setStored(answer.bot.appearance);
      onChanged(answer.bot);
      toast(s.appearanceSaved);
      return true;
    } catch (reason) {
      setError(utils.apiErrorMessage(reason) || s.appearanceSaveFailed);
      return false;
    } finally { setPending(false); }
  };
  const autosave = hooks.useAutoSaveStatus([editVersion], async () => {
    if (!(await save())) throw new Error(error ?? s.appearanceSaveFailed);
  }, { savable: name.trim() !== '' && valid, delay: 900 });

  return <>
    <C.Modal title={s.appearanceTitle} icon={Palette} size="lg" presentation="center" closeLabel={s.cancel} closeDisabled={pending} {...(pending ? { 'aria-busy': true as const } : {})} onClose={onClose}>
      <C.ModalBody>
        <div className="flex flex-col gap-6">
          <div role="group" aria-label={s.appearanceTemplates} className="flex gap-3 overflow-x-auto pb-2">
            {APPEARANCE_TEMPLATE_IDS.map(template => <C.Button key={template} variant={stored.template === template ? 'accent' : 'outline'} className="h-auto min-w-28 flex-1 flex-col gap-2 p-2" disabled={pending} aria-pressed={stored.template === template} onClick={() => { if (template !== stored.template) setTemplateChoice(template); }}>
              <TemplateSwatch template={template} /><span>{s[`appearanceTemplate_${template}`]}</span>
            </C.Button>)}
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
            <div className="order-2 flex min-w-0 flex-col gap-5 lg:order-1">
              {section(s.appearanceColorsLabel, <Palette size={18} />, <>
                {select('mode', s.appearanceModeLabel, appearance.mode, [{ value: 'light', label: s.appearanceModeLight }, { value: 'dark', label: s.appearanceModeDark }])}
                <div className="grid grid-cols-2 gap-4">{color('panel', s.appearanceColorPanel)}{color('visitorBubble', s.appearanceColorVisitor)}{color('botBubble', s.appearanceColorBot)}</div>
                {gradientEnd('visitorBubbleEnd', s.appearanceGradientVisitor, appearance.colors.visitorBubble)}
                {gradientEnd('headerEnd', s.appearanceGradientHeader, appearance.colors.header ?? appearanceRamp(appearance).header)}
                {gradientEnd('launcherEnd', s.appearanceGradientLauncher, appearance.colors.launcher)}
                {scalar('width', 'width', s.appearanceWidthLabel, appearance.width)}
                {scalar('height', 'height', s.appearanceHeightLabel, appearance.height)}
                {scalar('radius', 'radius', s.appearanceRadiusLabel, appearance.radius)}
              </>)}
              {section(s.appearanceEffectsGroup, <Sparkles size={18} />, <>
                {toggle('effects.glass', s.appearanceGlass, appearance.effects.glass)}
                {appearance.effects.glass ? <>{metric('effects.glassBlur', 'glassBlur', s.appearanceGlassBlur, appearance.effects.glassBlur, 'px')}{metric('effects.glassOpacity', 'glassOpacity', s.appearanceGlassOpacity, appearance.effects.glassOpacity, '%')}</> : null}
                {select('effects.buttonHover', s.appearanceHover, appearance.effects.buttonHover, ['lift', 'fill', 'shine', 'glow'].map(value => ({ value, label: s[`appearanceHover_${value}`] })))}
                {metric('effects.buttonIntensity', 'buttonIntensity', s.appearanceIntensity, appearance.effects.buttonIntensity, '%')}
                {select('effects.messageEntrance', s.appearanceEntrance, appearance.effects.messageEntrance, ['none', 'fade', 'slide'].map(value => ({ value, label: s[`appearanceEntrance_${value}`] })))}
              </>)}
              {section(s.appearanceSendGroup, <Send size={18} />, <>
                <div className="grid grid-cols-2 gap-4">{color('sendButton', s.appearanceColorSend)}{color('sendIcon', s.appearanceColorSendIcon)}</div>
                {iconPicker('send.icon', s.appearanceSendIcon, appearance.send.icon)}
                {select('send.shape', s.appearanceSendShape, appearance.send.shape, [{ value: 'circle', label: s.appearanceShapeCircle }, { value: 'rounded-square', label: s.appearanceShapeSquare }])}
              </>)}
              {section(s.appearanceLauncherGroup, <MousePointerClick size={18} />, <>
                {color('launcher', s.appearanceColorLauncher)}
                {iconPicker('launcher.icon', s.appearanceLauncherIcon, appearance.launcher.icon)}
                {toggle('launcher.presenceDot', s.appearancePresenceLabel, appearance.launcher.presenceDot, s.appearancePresenceHint)}
                {colorControl('launcher.presenceDotColor', s.appearanceColorPresence, appearance.launcher.presenceDotColor)}
                {textField('launcher.label', s.appearanceLauncherLabel, appearance.launcher.label, APPEARANCE_LAUNCHER_LABEL_MAX_CHARS)}
                {textField('launcher.teaser', s.appearanceTeaser, appearance.launcher.teaser, APPEARANCE_TEASER_MAX_CHARS)}
                {appearance.launcher.teaser !== '' ? metric('launcher.teaserDelay', 'teaserDelay', s.appearanceTeaserDelay, appearance.launcher.teaserDelay, 's') : null}
                {select('launcher.nudge', s.appearanceNudge, appearance.launcher.nudge, ['none', 'bounce', 'wiggle'].map(value => ({ value, label: s[`appearanceNudge_${value}`] })))}
                {appearance.launcher.nudge !== 'none' ? metric('launcher.nudgeDelay', 'nudgeDelay', s.appearanceNudgeDelay, appearance.launcher.nudgeDelay, 's') : null}
                {toggle('launcher.ring', s.appearanceRing, appearance.launcher.ring)}
                {toggle('launcher.unreadBadge', s.appearanceUnreadBadge, appearance.launcher.unreadBadge)}
                {select('position', s.appearancePositionLabel, appearance.position, [
                  { value: 'bottom-right', label: s.appearancePositionBottomRight }, { value: 'bottom-left', label: s.appearancePositionBottomLeft },
                  { value: 'top-right', label: s.appearancePositionTopRight }, { value: 'top-left', label: s.appearancePositionTopLeft },
                ])}
                {scalar('launcher.size', 'launcherSize', s.appearanceLauncherSize, appearance.launcher.size)}
                {scalar('launcher.offset', 'launcherOffset', s.appearanceLauncherOffset, appearance.launcher.offset)}
              </>)}
              {section(s.appearanceSoundGroup, <Volume2 size={18} />, <>
                {select('sound.tone', s.appearanceTone, appearance.sound.tone, ['none', 'drop', 'chime', 'pop', 'bell'].map(value => ({ value, label: s[`appearanceTone_${value}`] })))}
                <div className="text-sm"><C.Button variant="outline" size="sm" disabled={pending || appearance.sound.tone === 'none'} onClick={() => { void unlockSound().then(() => playTone(appearance.sound.tone, appearance.sound.volume)); }}>{s.appearancePlay}</C.Button></div>
                {metric('sound.volume', 'soundVolume', s.appearanceVolume, appearance.sound.volume, '%')}
              </>)}
              {section(s.appearanceHeaderGroup, <UserRound size={18} />, <>
                {color('header', s.appearanceColorHeader)}
                <C.Field label={s.appearanceNameLabel} hint={s.appearanceNameHint}><C.Input aria-label={s.appearanceNameLabel} value={name} maxLength={DISPLAY_NAME_MAX_CHARS} disabled={pending} onChange={event => { setName(event.target.value); setEditVersion(version => version + 1); }} /></C.Field>
                {textField('header.subtitle', s.appearanceSubtitle, appearance.header.subtitle, APPEARANCE_SUBTITLE_MAX_CHARS)}
                {toggle('header.showAvatar', s.appearanceShowAvatar, appearance.header.showAvatar)}
                {textField('avatarUrl', s.appearanceAvatarLabel, appearance.avatarUrl, APPEARANCE_AVATAR_URL_MAX_CHARS, s.appearanceAvatarPlaceholder, s.appearanceAvatarHint)}
                {toggle('header.showMessageName', s.appearanceShowMessageName, appearance.header.showMessageName)}
              </>)}
              {section(s.appearanceTypographyGroup, <Type size={18} />, <>
                {scalar('typography.fontSize', 'fontSize', s.appearanceFontSize, appearance.typography.fontSize)}
                {select('typography.fontFamily', s.appearanceFontFamily, appearance.typography.fontFamily, Object.keys(APPEARANCE_FONT_STACKS).map(value => ({ value, label: s[`appearanceFont_${value}`] })))}
                {select('typography.shadow', s.appearanceShadow, appearance.typography.shadow, Object.keys(APPEARANCE_SHADOWS).map(value => ({ value, label: s[`appearanceShadow_${value}`] })))}
                {textField('typography.placeholder', s.appearancePlaceholder, appearance.typography.placeholder, APPEARANCE_PLACEHOLDER_MAX_CHARS)}
                {field('intro', s.appearanceIntroLabel, <C.Textarea id={`${id}-intro`} aria-label={s.appearanceIntroLabel} value={appearance.intro ?? ''} rows={3} maxLength={APPEARANCE_INTRO_MAX_CHARS} disabled={pending} placeholder={s.appearanceIntroPlaceholder} onChange={event => patch('intro', event.target.value || null)} />, s.appearanceIntroHint)}
              </>)}
              {section(s.appearanceQuickLabel, <MousePointerClick size={18} />, <>
                <ul className="flex flex-wrap gap-2">
                  {appearance.quickButtons.map(button => <li key={button.text} className="flex max-w-full items-center gap-2 rounded-full border border-border bg-card py-1 pl-3 pr-1 text-sm">
                    {button.icon === null ? null : <Icon id={button.icon} />}<span className="break-words">{button.text}</span>
                    <C.IconButton icon={Trash2} variant="danger" label={s.appearanceQuickRemove.replace('{value}', button.text)} disabled={pending} onClick={() => patch('quickButtons', appearance.quickButtons.filter(item => item.text !== button.text))} />
                  </li>)}
                </ul>
                <div className="flex flex-col gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <C.Input className="min-w-0 flex-1" aria-label={s.appearanceQuickAdd} value={draftButton} maxLength={APPEARANCE_QUICK_BUTTON_MAX_CHARS} disabled={pending || quickFull} placeholder={s.appearanceQuickPlaceholder} onChange={event => setDraftButton(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addButton(); } }} />
                    <C.IconButton icon={Plus} label={s.appearanceQuickAdd} disabled={pending || quickFull || duplicate || !buttonText} onClick={addButton} />
                  </div>
                  <C.SelectMenu label={s.appearanceQuickIcon} value={draftIcon ?? ''} disabled={pending || quickFull} onChange={value => setDraftIcon(value === '' ? null : value as AppearanceIconId)} options={[{ value: '', label: s.appearanceIconNone }, ...icons]} />
                </div>
                {duplicate ? <p className="text-xs text-destructive">{s.appearanceQuickDuplicate}</p> : null}
                {quickFull ? <p className="text-xs text-muted-foreground">{s.appearanceQuickFull}</p> : null}
              </>, s.appearanceQuickHint, reset('quickButtons', s.appearanceQuickLabel))}
            </div>
            <div className="order-1 min-w-0 lg:sticky lg:top-0 lg:order-2"><AppearancePreview look={look} label={s.appearancePreview} /></div>
          </div>
        </div>
      </C.ModalBody>
      <C.ModalFooter>
        {error !== null ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        {!valid ? <p className="text-xs text-destructive" role="alert">{s.appearanceInvalid}</p> : null}
        <C.AutoSaveStatus status={autosave.status} onRetry={autosave.retry} />
        <C.Button variant="ghost" disabled={pending || autosave.status === 'saving'} onClick={onClose}>{s.cancel}</C.Button>
      </C.ModalFooter>
    </C.Modal>
    <C.ConfirmDialog open={templateChoice !== null} title={s.appearanceTemplateConfirm} description={s.appearanceTemplateReplace} confirmLabel={s.appearanceTemplateApply} onClose={() => setTemplateChoice(null)} onConfirm={() => { if (templateChoice !== null) { setStored(selectAppearanceTemplate(templateChoice)); setEditVersion(version => version + 1); setDraftButton(''); setDraftIcon(null); setTemplateChoice(null); } }} />
  </>;
}
