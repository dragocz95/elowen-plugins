import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Activity } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoSaveStatus } from './ui/hostComponents';
import { useAutoSaveStatus } from './ui/useAutoSaveStatus';
import type {
  AutoSaveStatusProps,
  UseAutoSaveStatusOptions,
  UseAutoSaveStatusResult,
} from '../plugins/autoSaveContract';

const HOST_HOOK_HASH = '9b2afdea6982535dd5b81285798d7152e378e4d80bd7e80c2ecfa867818d8775';
const registryRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const requireFromHere = createRequire(import.meta.url);
const configuredCoreRoot = process.env.ELOWEN_CORE_ROOT?.trim();
if (!configuredCoreRoot) {
  throw new Error('[autosave-contract] ELOWEN_CORE_ROOT must point to the authoritative core checkout');
}
const coreRoot = resolve(configuredCoreRoot);
const hostHookPath = join(coreRoot, 'web/lib/useAutoSaveStatus.ts');
const coreUiKitTypesPath = join(coreRoot, 'packages/plugin-ui-kit/index.d.ts');
const resolvedUiKitTypesPath = join(dirname(requireFromHere.resolve('elowen-plugin-ui-kit')), 'index.d.ts');
if (!existsSync(hostHookPath) || !existsSync(coreUiKitTypesPath)) {
  throw new Error(`[autosave-contract] ELOWEN_CORE_ROOT is not a source checkout with the API 13 files: ${coreRoot}`);
}
const coreUiKitTypes = readFileSync(coreUiKitTypesPath, 'utf8');
if (!/PLUGIN_UI_API_VERSION:\s*13\b/.test(coreUiKitTypes)) {
  throw new Error(`[autosave-contract] ELOWEN_CORE_ROOT does not expose plugin UI API 13: ${coreRoot}`);
}

function hookBody(source: string, path: string): string {
  const start = source.indexOf('export function useAutoSaveStatus(');
  if (start < 0) throw new Error(`[autosave-contract] useAutoSaveStatus export missing from ${path}`);
  return source.slice(start);
}

function hash(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('registry auto-save ABI', () => {
  it('uses the API 13 ui-kit declarations from the configured core', () => {
    expect(readFileSync(resolvedUiKitTypesPath, 'utf8')).toBe(coreUiKitTypes);
  });

  it('keeps the copied hook implementation aligned with the pinned final host source', () => {
    const fixturePath = join(registryRoot, 'tests/ui/useAutoSaveStatus.ts');
    const fixture = hookBody(readFileSync(fixturePath, 'utf8'), fixturePath);
    const host = hookBody(readFileSync(hostHookPath, 'utf8'), hostHookPath);
    expect(hash(host), `stale or wrong ELOWEN_CORE_ROOT: ${coreRoot}`).toBe(HOST_HOOK_HASH);
    expect(hash(fixture)).toBe(HOST_HOOK_HASH);
    expect(fixture).toBe(host);
  });

  it('honours ready and savable guards through debounce, retry, and flush', async () => {
    vi.useFakeTimers();
    let saves = 0;
    const options: UseAutoSaveStatusOptions = { ready: false, savable: true, delay: 25 };
    const { result, rerender } = renderHook(({ ready, value, savable }) => useAutoSaveStatus(
      [value],
      () => { saves += 1; },
      { ...options, ready, savable },
    ), { initialProps: { ready: false, value: 'seed', savable: true } });
    const typedResult: UseAutoSaveStatusResult = result.current;
    expect(typedResult.status).toBe('idle');

    rerender({ ready: true, value: 'seed', savable: true });
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(saves).toBe(0);

    rerender({ ready: true, value: '', savable: false });
    await act(async () => { vi.advanceTimersByTime(100); });
    await act(async () => {
      expect(await result.current.flush()).toBe('idle');
      await result.current.retry();
    });
    expect(saves).toBe(0);
    expect(result.current.status).toBe('idle');

    rerender({ ready: true, value: 'valid', savable: true });
    await act(async () => { vi.advanceTimersByTime(25); });
    expect(saves).toBe(1);
    expect(result.current.status).toBe('saved');
  });

  it('serializes a queued latest edit and exposes promise-based retry', async () => {
    vi.useFakeTimers();
    const saves: string[] = [];
    let rejectFirst!: (error: Error) => void;
    let failNext = false;
    const { result, rerender } = renderHook(({ value }) => useAutoSaveStatus(
      [value],
      () => {
        saves.push(value);
        if (saves.length === 1) return new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('temporary'));
        }
        return Promise.resolve();
      },
      { delay: 10 },
    ), { initialProps: { value: 'seed' } });

    rerender({ value: 'first' });
    await act(async () => { vi.advanceTimersByTime(10); });
    rerender({ value: 'latest' });
    await act(async () => { vi.advanceTimersByTime(10); });
    expect(saves).toEqual(['first']);
    act(() => rejectFirst(new Error('superseded')));
    await act(async () => {});
    expect(saves).toEqual(['first', 'latest']);
    expect(result.current.status).toBe('saved');

    failNext = true;
    rerender({ value: 'retry-me' });
    await act(async () => { vi.advanceTimersByTime(10); });
    await act(async () => {});
    expect(result.current.status).toBe('error');
    await act(async () => { expect(await result.current.retry()).toBeUndefined(); });
    expect(saves).toEqual(['first', 'latest', 'retry-me', 'retry-me']);
    expect(result.current.status).toBe('saved');
  });

  it('reports pending activation and supports promise flush plus reset', async () => {
    vi.useFakeTimers();
    let saves = 0;
    let activationPending = true;
    const { result, rerender } = renderHook(({ value }) => useAutoSaveStatus(
      [value],
      () => { saves += 1; return { pending: activationPending }; },
      { delay: 50 },
    ), { initialProps: { value: 'seed' } });

    rerender({ value: 'pending' });
    await act(async () => { expect(await result.current.flush()).toBe('pending'); });
    expect(saves).toBe(1);
    expect(result.current.status).toBe('pending');

    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');
    rerender({ value: 'cancelled' });
    act(() => result.current.reset());
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(saves).toBe(1);

    activationPending = false;
    await act(async () => { await result.current.retry(); });
    expect(result.current.status).toBe('saved');
  });

  it('survives React Activity lifecycle without replaying unchanged values', async () => {
    let failing = false;
    let saves = 0;
    let seen: AutoSaveStatusProps['status'] = 'idle';
    function Probe({ value }: { value: string }) {
      const { status } = useAutoSaveStatus([value], async () => {
        saves += 1;
        if (failing) throw new Error('rejected');
      }, { delay: 5 });
      seen = status;
      return null;
    }
    const harness = (hidden: boolean, value: string) => (
      <Activity mode={hidden ? 'hidden' : 'visible'}><Probe value={value} /></Activity>
    );

    const { rerender } = render(harness(false, 'seed'));
    rerender(harness(true, 'seed'));
    rerender(harness(false, 'seed'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saves).toBe(0);

    failing = true;
    rerender(harness(false, 'edited'));
    await waitFor(() => expect(seen).toBe('error'));
    expect(saves).toBe(1);
  });
});

describe('registry AutoSaveStatus contract', () => {
  const cases: { status: AutoSaveStatusProps['status']; text?: string; role: 'status' | 'alert' }[] = [
    { status: 'idle', role: 'status' },
    { status: 'saving', text: 'Saving…', role: 'status' },
    { status: 'pending', text: 'Saved; activation pending', role: 'status' },
    { status: 'saved', text: 'Saved', role: 'status' },
    { status: 'error', text: "Couldn't save", role: 'alert' },
  ];

  it.each(cases)('renders the $status state with the host accessibility semantics', ({ status, text, role }) => {
    render(<AutoSaveStatus status={status} />);
    const region = screen.getByRole(role);
    if (status === 'error') expect(region).not.toHaveAttribute('aria-live');
    else expect(region).toHaveAttribute('aria-live', 'polite');
    if (text) expect(region).toHaveTextContent(text);
    else expect(region).toBeEmptyDOMElement();
  });

  it('exposes Retry only for an error and invokes it', () => {
    const retry = vi.fn();
    const { rerender } = render(<AutoSaveStatus status="pending" onRetry={retry} />);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    rerender(<AutoSaveStatus status="error" onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
