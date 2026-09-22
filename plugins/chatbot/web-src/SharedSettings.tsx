import { ShieldCheck, Wrench } from 'lucide-react';
import { runtime, type PluginConfigField } from './runtime';
import { useChatbots } from './useChatbots';

/** THE SHARED SETTINGS SECTION: what applies to every chatbot at once.
 *
 *  Two things on this plugin's contract are instance-wide, and they are both here:
 *
 *  1. The plugin's own configuration. Today that is one field — how long a visitor token stays valid —
 *     declared in `elowen-plugin.json` `configSchema` and enforced by the server for every chatbot there
 *     is. It is edited by the HOST's own config form: that form already reads the manifest schema, draws
 *     a slider beside the box for a bounded number, owns the debounce and the save, and reports the save
 *     state. A second form here would be a second way to write one record.
 *  2. The tool every chatbot account must be allowed to reach. It is the plugin's own requirement, the
 *     same list the create dialog grants and the drawer warns about per chatbot, so this states it once
 *     as a fact. It is NOT editable here: a grant belongs to one account and the Users screen owns it.
 *
 *  Everything else a reader might expect here is per-chatbot by contract, not by omission: the limits, the
 *  retention window and the appearance are fields of ONE chatbot's row (`PATCH /bots`, `PUT /appearance`),
 *  and there is no defaults record behind them for a new chatbot to inherit. Inventing one on this surface
 *  would be inventing a server behaviour that does not exist. */
export function SharedSettings({ plugin }: { plugin: string }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  // The required tools are the register's answer, read from the same cached request every other section
  // reads: this section states a fact the server already told the page.
  const { requiredTools } = useChatbots();
  const { locale, t } = hooks.useTranslation();
  const detail = hooks.usePluginDetail(plugin);
  const draft = hooks.usePluginConfigDraft(plugin, {
    config: detail.data?.config ?? {},
    configSchema: detail.data?.configSchema ?? [],
  });

  // A config field's own copy comes from the MANIFEST and its `i18n/<lang>.json` `fields` block — the
  // same source Settings → Plugins reads it from. It is not page copy, so it is not restated as a bundle
  // string: two records of one label are two things that can disagree.
  const translated = detail.data?.i18n?.[locale]?.fields;
  const fieldLabel = (field: PluginConfigField): string => translated?.[field.key]?.label ?? field.label;
  const fieldHint = (field: PluginConfigField): string | undefined => translated?.[field.key]?.hint ?? field.hint;
  const fieldOptions = (field: PluginConfigField) => (field.options ?? []).map((option) => ({
    ...option,
    label: translated?.[field.key]?.options?.[option.value] ?? option.label,
  }));
  // The host's own words for its own risk scale.
  const riskText = (risk: 'low' | 'medium' | 'high'): string =>
    risk === 'high' ? t.pluginDetail.riskHigh : risk === 'medium' ? t.pluginDetail.riskMedium : t.pluginDetail.riskLow;

  return (
    <div className="flex flex-col gap-3">
      {detail.isError ? <C.ErrorState message={s.sharedLoadError} onRetry={() => detail.refetch()} />
        : detail.data === undefined ? <C.LoadingState variant="block" />
          : (
            <C.SettingsDocument>
              <C.PluginConfigEditor
                name={plugin}
                detail={detail.data}
                draft={draft}
                mode="all"
                fieldLabel={fieldLabel}
                fieldHint={fieldHint}
                fieldOptions={fieldOptions}
                riskText={riskText}
              />
            </C.SettingsDocument>
          )}

      <C.SettingsGroup title={s.sharedRequirementsTitle} icon={ShieldCheck} density="compact">
        <C.SettingsRow
          label={s.toolsRequiredLabel}
          description={s.toolsRequiredHint}
          icon={Wrench}
          status={(
            <span className="font-mono text-xs">
              {requiredTools.length === 0 ? '—' : requiredTools.join(', ')}
            </span>
          )}
        />
      </C.SettingsGroup>
    </div>
  );
}
