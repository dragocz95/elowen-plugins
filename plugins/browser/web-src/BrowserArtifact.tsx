import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { ArrowLeft, ArrowRight, Expand, Globe2, Hand, Monitor, RotateCw, ShieldCheck, X } from 'lucide-react';
import type { BrowserArtifactProps } from './runtime';
import { apiError, jsonRequest, runtime } from './runtime';
import { useBrowserStream } from './useBrowserStream';

interface ArtifactData {
  browserSessionId: string;
  state: 'creating' | 'agent' | 'user' | 'closing' | 'closed' | 'error';
  title: string;
  url: string;
  lastAction: string | null;
}
interface Lease { leaseId: string; expiresAt: number }

const asData = (value: unknown): ArtifactData | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<ArtifactData>;
  if (typeof raw.browserSessionId !== 'string') return null;
  return {
    browserSessionId: raw.browserSessionId,
    state: raw.state ?? 'agent',
    title: typeof raw.title === 'string' ? raw.title : '',
    url: typeof raw.url === 'string' ? raw.url : '',
    lastAction: typeof raw.lastAction === 'string' ? raw.lastAction : null,
  };
};

const inputPath = (sessionId: string, action: string): string => `/plugins/browser/api/${action}?sessionId=${encodeURIComponent(sessionId)}`;

export function BrowserArtifact({ artifact }: BrowserArtifactProps) {
  const host = runtime();
  const { Button, IconButton, Badge, Modal, ModalBody, ModalFooter, ConfirmDialog } = host.components;
  const strings = host.hooks.usePluginStrings('browser');
  const toast = host.hooks.useToast();
  const data = asData(artifact.data);
  const stream = useBrowserStream(artifact.media?.path);
  const [expanded, setExpanded] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [lease, setLease] = useState<Lease | null>(null);
  const pointerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMove = useRef<Record<string, unknown> | null>(null);
  const sessionId = data?.browserSessionId ?? '';
  const title = data?.title || strings.sessionTitle || 'Browser session';
  const url = data?.url || '';
  const state = stream.closed ? 'closed' : lease || stream.control.state === 'user' || data?.state === 'user' ? 'user' : data?.state ?? 'agent';
  const takeoverRequested = stream.control.state === 'agent' && stream.control.reason === 'requested';
  const frame = stream.frame;
  const action = stream.action
    ? `${strings[`action_${stream.action.kind}`] || stream.action.kind}${stream.action.target ? ` · ${stream.action.target}` : ''}`
    : takeoverRequested ? strings.waitingForUser || 'Waiting for user input' : data?.lastAction;

  useEffect(() => () => { if (pointerTimer.current) clearTimeout(pointerTimer.current); }, []);
  useEffect(() => {
    if (!lease) return;
    const interval = setInterval(() => {
      void runtime().api(inputPath(sessionId, 'heartbeat'), jsonRequest('POST', { leaseId: lease.leaseId }))
        .then((value) => {
          const next = value as { expiresAt?: number };
          if (typeof next.expiresAt === 'number') setLease((current) => current?.leaseId === lease.leaseId ? { ...current, expiresAt: next.expiresAt! } : current);
        })
        .catch(() => setLease((current) => current?.leaseId === lease.leaseId ? null : current));
    }, 20_000);
    return () => clearInterval(interval);
  }, [lease, sessionId]);
  useEffect(() => {
    if (stream.control.state === 'agent') setLease(null);
  }, [stream.control.state]);

  const status = useMemo(() => {
    if (stream.closed || state === 'closed') return { tone: 'muted' as const, label: strings.closed || 'Closed' };
    if (stream.error) return { tone: 'danger' as const, label: strings.disconnected || 'Disconnected' };
    if (state === 'user') return { tone: 'accent' as const, label: lease ? strings.youControl || 'You control' : strings.userControl || 'User control' };
    return { tone: stream.connected ? 'success' as const : 'warning' as const, label: stream.connected ? strings.agentControl || 'Agent control' : strings.connecting || 'Connecting' };
  }, [lease, state, stream.closed, stream.connected, stream.error, strings]);

  const run = async <T,>(name: string, operation: () => Promise<T>): Promise<T | undefined> => {
    setPending(name);
    try { return await operation(); }
    catch (error) { toast.toast(apiError(error), 'error'); return undefined; }
    finally { setPending(null); }
  };

  const takeControl = async (): Promise<void> => {
    const result = await run('takeover', () => runtime().api(inputPath(sessionId, 'takeover'), jsonRequest('POST')) as Promise<Lease>);
    if (result) setLease(result);
  };
  const releaseControl = async (): Promise<void> => {
    if (!lease) return;
    const released = await run('release', () => runtime().api(inputPath(sessionId, 'release'), jsonRequest('POST', { leaseId: lease.leaseId })));
    if (released !== undefined) setLease(null);
  };
  const closeSession = async (): Promise<void> => {
    const closed = await run('close', () => runtime().api(inputPath(sessionId, 'close'), jsonRequest('POST')));
    if (closed !== undefined) { setConfirmClose(false); setExpanded(false); }
  };
  const command = async (events: Record<string, unknown>[]): Promise<void> => {
    if (!lease || events.length === 0) return;
    await runtime().api(inputPath(sessionId, 'input'), jsonRequest('POST', { leaseId: lease.leaseId, events }));
  };
  const shortcut = (key: string, code: string, modifiers: string[] = []): void => {
    void command([
      { type: 'key', action: 'down', key, code, modifiers },
      { type: 'key', action: 'up', key, code, modifiers },
    ]).catch((error) => toast.toast(apiError(error), 'error'));
  };

  const pointerEvent = (event: PointerEvent<HTMLDivElement>, actionName: 'move' | 'down' | 'up'): Record<string, unknown> => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      type: 'pointer', action: actionName,
      x: event.clientX - rect.left, y: event.clientY - rect.top,
      surfaceWidth: rect.width, surfaceHeight: rect.height,
      button: event.button === 1 ? 'middle' : event.button === 2 ? 'right' : 'left',
      modifiers: [event.altKey ? 'Alt' : '', event.ctrlKey ? 'Control' : '', event.metaKey ? 'Meta' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean),
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!lease) return;
    pendingMove.current = pointerEvent(event, 'move');
    if (pointerTimer.current) return;
    pointerTimer.current = setTimeout(() => {
      pointerTimer.current = null;
      const next = pendingMove.current;
      pendingMove.current = null;
      if (next) void command([next]).catch((error) => toast.toast(apiError(error), 'error'));
    }, 50);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!lease) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    void command([pointerEvent(event, 'down')]).catch((error) => toast.toast(apiError(error), 'error'));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!lease) return;
    void command([pointerEvent(event, 'up')]).catch((error) => toast.toast(apiError(error), 'error'));
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (!lease) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    void command([{
      type: 'wheel', x: event.clientX - rect.left, y: event.clientY - rect.top,
      surfaceWidth: rect.width, surfaceHeight: rect.height,
      deltaX: event.deltaX, deltaY: event.deltaY,
      modifiers: [event.altKey ? 'Alt' : '', event.ctrlKey ? 'Control' : '', event.metaKey ? 'Meta' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean),
    }]).catch((error) => toast.toast(apiError(error), 'error'));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>, actionName: 'down' | 'up'): void => {
    if (!lease) return;
    if (actionName === 'down') event.preventDefault();
    void command([{
      type: 'key', action: actionName, key: event.key, code: event.code,
      modifiers: [event.altKey ? 'Alt' : '', event.ctrlKey ? 'Control' : '', event.metaKey ? 'Meta' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean),
    }]).catch((error) => toast.toast(apiError(error), 'error'));
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    if (!lease) return;
    const text = event.clipboardData.getData('text');
    if (!text) return;
    event.preventDefault();
    void command([{ type: 'paste', text }]).catch((error) => toast.toast(apiError(error), 'error'));
  };

  const viewport = (interactive: boolean) => (
    <div
      className={`browser-artifact__viewport ${interactive && lease ? 'is-interactive' : ''}`}
      tabIndex={interactive && lease ? 0 : -1}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onWheel={interactive ? onWheel : undefined}
      onKeyDown={interactive ? (event) => onKey(event, 'down') : undefined}
      onKeyUp={interactive ? (event) => onKey(event, 'up') : undefined}
      onPaste={interactive ? onPaste : undefined}
      onContextMenu={interactive && lease ? (event) => event.preventDefault() : undefined}
      aria-label={strings.browserViewport || 'Live browser view'}
    >
      {frame ? <img src={`data:${frame.mimeType};base64,${frame.data}`} alt="" draggable={false} /> : (
        <div className="browser-artifact__empty"><Monitor size={24} /><span>{stream.error || strings.waitingFrame || 'Waiting for the browser image…'}</span></div>
      )}
      {stream.cursor && frame ? (
        <span
          className={`browser-artifact__cursor ${stream.cursor.clicking ? 'is-clicking' : ''}`}
          style={{ left: `${(stream.cursor.x / frame.width) * 100}%`, top: `${(stream.cursor.y / frame.height) * 100}%` }}
          aria-hidden
        ><svg width="28" height="34" viewBox="0 0 28 34"><path d="M2 2l19 15-9 2 5 10-5 2-5-10-5 6z" /></svg></span>
      ) : null}
      <div className="browser-artifact__bubble">
        <span className="browser-artifact__pulse" />
        <span>{action || (state === 'user' ? strings.waitingForUser || 'Waiting for user input' : strings.agentWorking || 'The agent is working in the browser')}</span>
      </div>
    </div>
  );

  if (!data) return <div className="browser-artifact__fallback">{artifact.fallback}</div>;

  return (
    <section className="browser-artifact" aria-label={strings.sessionTitle || 'Browser session'}>
      <header className="browser-artifact__header">
        <div className="browser-artifact__identity">
          <span className="browser-artifact__icon"><Globe2 size={15} /></span>
          <div><strong>{title}</strong><span>{url || strings.noAddress || 'No address yet'}</span></div>
        </div>
        <div className="browser-artifact__actions">
          <Badge tone={status.tone}>{status.label}</Badge>
          <IconButton icon={Expand} label={strings.enlarge || 'Enlarge'} onClick={() => setExpanded(true)} />
        </div>
      </header>
      <button type="button" className="browser-artifact__preview" onClick={() => setExpanded(true)} aria-label={strings.enlarge || 'Enlarge browser'}>
        {viewport(false)}
      </button>
      <footer className="browser-artifact__footer">
        <span>{stream.connected ? strings.live || 'Live' : strings.reconnecting || 'Reconnecting'}</span>
        <div>
          {state === 'user' && lease ? <Button variant="accent" icon={ShieldCheck} onClick={() => { void releaseControl(); }} disabled={pending !== null}>{strings.returnToAgent || 'Return to agent'}</Button>
            : state === 'user' ? <Button variant="ghost" icon={Hand} disabled>{strings.controlledElsewhere || 'Controlled in another window'}</Button>
            : <Button variant="ghost" icon={Hand} onClick={() => { void takeControl(); }} disabled={pending !== null || stream.closed}>{strings.takeControl || 'Take control'}</Button>}
          <Button variant="ghost-danger" icon={X} onClick={() => setConfirmClose(true)} disabled={pending !== null || stream.closed}>{strings.closeSession || 'Close'}</Button>
        </div>
      </footer>

      {expanded ? (
        <Modal
          title={title}
          description={url || undefined}
          icon={Globe2}
          size="xl"
          presentation="center"
          intent="edit"
          closeLabel={strings.closeView || 'Close view'}
          onClose={() => setExpanded(false)}
          headerActions={<Badge tone={status.tone}>{status.label}</Badge>}
        >
          <ModalBody gap={4}>
            <div className="browser-artifact__toolbar">
              <IconButton icon={ArrowLeft} label={strings.back || 'Back'} onClick={() => shortcut('ArrowLeft', 'ArrowLeft', ['Alt'])} disabled={!lease} />
              <IconButton icon={ArrowRight} label={strings.forward || 'Forward'} onClick={() => shortcut('ArrowRight', 'ArrowRight', ['Alt'])} disabled={!lease} />
              <IconButton icon={RotateCw} label={strings.reload || 'Reload'} onClick={() => shortcut('r', 'KeyR', ['Control'])} disabled={!lease} />
              <div className="browser-artifact__address"><ShieldCheck size={13} /><span>{url || strings.noAddress || 'No address yet'}</span></div>
            </div>
            {viewport(true)}
          </ModalBody>
          <ModalFooter status={stream.error ? <span className="text-destructive">{stream.error}</span> : <span>{status.label}</span>}>
            {state === 'user' && lease ? <Button variant="accent" icon={ShieldCheck} onClick={() => { void releaseControl(); }} disabled={pending !== null}>{strings.returnToAgent || 'Return to agent'}</Button>
              : state === 'user' ? <Button variant="ghost" icon={Hand} disabled>{strings.controlledElsewhere || 'Controlled in another window'}</Button>
              : <Button variant="default" icon={Hand} onClick={() => { void takeControl(); }} disabled={pending !== null || stream.closed}>{strings.takeControl || 'Take control'}</Button>}
            <Button variant="ghost-danger" icon={X} onClick={() => setConfirmClose(true)} disabled={pending !== null || stream.closed}>{strings.closeSession || 'Close session'}</Button>
          </ModalFooter>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={confirmClose}
        title={strings.closeConfirmTitle || 'Close browser session?'}
        description={strings.closeConfirmDescription || 'The live view and tab will close. Your browser profile and sign-in data remain stored.'}
        confirmLabel={strings.closeSession || 'Close session'}
        confirmVariant="danger"
        pending={pending === 'close'}
        onConfirm={() => { void closeSession(); }}
        onClose={() => setConfirmClose(false)}
      />
    </section>
  );
}
