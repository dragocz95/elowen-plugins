import { useState } from 'react';
import { KeyRound, Server, ShieldCheck, Trash2 } from 'lucide-react';
import { jsonBody, runtime, SITES_LIST_KEY, type GatewayView } from './runtime.js';

interface Values {
  apiUser: string;
  apiKey: string;
  username: string;
  clientIp: string;
  email: string;
}

const EMPTY: Values = { apiUser: '', apiKey: '', username: '', clientIp: '', email: '' };

/** Admin-only infrastructure form. Secret values are write-only: the API returns only which fields are
 * present, so a browser, screenshot or copied page can never recover the Namecheap key from Elowen. */
export function GatewaySettings({ gateway }: { gateway: GatewayView }) {
  const { components, hooks, utils } = runtime();
  const { Badge, Button, ConfirmDialog, Input } = components;
  const strings = hooks.usePluginStrings('sites');
  const queryClient = hooks.useQueryClient();
  const { toast } = hooks.useToast();
  const [values, setValues] = useState<Values>(EMPTY);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: SITES_LIST_KEY });
  };

  const save = hooks.useMutation<GatewayView, unknown, Values>({
    mutationFn: async (next: Values) => runtime().api('/plugins/sites/api/gateway', jsonBody('PUT', next)) as Promise<GatewayView>,
    onSuccess: async (next: GatewayView) => {
      setValues(EMPTY);
      await refresh();
      toast(next.status.active ? strings.gatewaySaved : (next.status.detail || strings.gatewayNotReady), next.status.active ? 'ok' : 'error');
    },
    onError: (error: unknown) => toast(utils.apiErrorMessage(error), 'error'),
  });

  const remove = hooks.useMutation<GatewayView, unknown, void>({
    mutationFn: async () => runtime().api('/plugins/sites/api/gateway', { method: 'DELETE' }) as Promise<GatewayView>,
    onSuccess: async () => {
      setConfirmRemove(false);
      await refresh();
      toast(strings.gatewayRemoved, 'ok');
    },
    onError: (error: unknown) => toast(utils.apiErrorMessage(error), 'error'),
  });

  const field = (key: keyof Values, label: string, type: 'text' | 'password' | 'email' = 'text') => (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">{label}</span>
      <Input
        type={type}
        autoComplete="off"
        value={values[key]}
        onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
        placeholder={gateway.configured[key] ? strings.gatewayStored : strings.gatewayRequired}
        disabled={save.isPending || remove.isPending}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface/40 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-accent">
            {gateway.status.active ? <ShieldCheck size={18} /> : <Server size={18} />}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-text">{strings.gatewayTitle}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">
              {gateway.status.active ? strings.gatewayActiveHint : (gateway.status.detail || strings.gatewayNotReady)}
            </p>
            {gateway.status.hostnameBase ? (
              <p className="mt-2 truncate font-mono text-[11px] text-text-muted">*.{gateway.status.hostnameBase}</p>
            ) : null}
          </div>
        </div>
        <Badge tone={gateway.status.active ? 'success' : 'warning'}>
          {gateway.status.active ? strings.gatewayActive : strings.gatewayInactive}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {field('apiUser', strings.gatewayApiUser)}
        {field('username', strings.gatewayUsername)}
        {field('apiKey', strings.gatewayApiKey, 'password')}
        {field('clientIp', strings.gatewayClientIp)}
        {field('email', strings.gatewayEmail, 'email')}
      </div>

      <div className="rounded-xl border border-border/80 bg-surface/25 p-4 text-xs leading-relaxed text-text-muted">
        <span className="mb-1.5 flex items-center gap-2 font-medium text-text"><KeyRound size={14} />{strings.gatewaySecretTitle}</span>
        {strings.gatewaySecretHint}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <Button variant="ghost-danger" icon={Trash2} onClick={() => setConfirmRemove(true)} disabled={remove.isPending}>
          {strings.gatewayRemove}
        </Button>
        <Button
          variant="accent"
          icon={ShieldCheck}
          onClick={() => save.mutate(values)}
          disabled={save.isPending || remove.isPending || !Object.values(values).some((value) => value.trim() !== '')}
        >
          {save.isPending ? strings.gatewaySaving : strings.gatewaySave}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={strings.gatewayRemoveTitle}
        description={strings.gatewayRemoveDescription}
        confirmLabel={strings.gatewayRemove}
        onConfirm={() => remove.mutate(undefined)}
        onClose={() => setConfirmRemove(false)}
      />
    </div>
  );
}
