import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoSaveStatus } from './ui/hostComponents';
import { useAutoSaveStatus } from './ui/useAutoSaveStatus';
import type {
  AutoSaveStatusProps,
  UseAutoSaveStatusOptions,
  UseAutoSaveStatusResult,
} from '../plugins/autoSaveContract';

const HOST_HOOK_HASH = '7c63144e929b44e472f11061a2d4756fc0e05c83d176a98a7def8a5c40822899';
const registryRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const requireFromHere = createRequire(import.meta.url);
const configuredCoreRoot = process.env.ELOWEN_CORE_ROOT?.trim();
const installedCoreRoot = dirname(requireFromHere.resolve('elowen/package.json'));
// CI and integration worktrees must opt into the exact core checkout they target. Falling back to a sibling
// directory made the parity assertion pass against an unrelated developer checkout.
const coreRoot = configuredCoreRoot ? resolve(configuredCoreRoot) : installedCoreRoot;
const hostHookPath = join(coreRoot, 'web/lib/useAutoSaveStatus.ts');

function normalizedHook(source: string): string {
  return source
    .slice(source.indexOf('export function useAutoSaveStatus('))
    .replace('opts: UseAutoSaveStatusOptions = {},', 'opts: { ready?: boolean; savable?: boolean; delay?: number } = {},')
    .replace('): UseAutoSaveStatusResult {', '): { status: SaveStatus; retry: () => void; flush: () => void } {');
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('registry auto-save ABI', () => {
  it('keeps the copied hook implementation aligned with the host source', () => {
    const fixture = readFileSync(join(registryRoot, 'tests/ui/useAutoSaveStatus.ts'), 'utf8');
    const fixtureHash = createHash('sha256').update(normalizedHook(fixture)).digest('hex');
    expect(fixtureHash).toBe(HOST_HOOK_HASH);
    if (existsSync(hostHookPath)) {
      expect(normalizedHook(fixture)).toBe(normalizedHook(readFileSync(hostHookPath, 'utf8')));
    }
  });

  it('uses the shared options and result contract at runtime', async () => {
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
    expect(saves).toBe(0);

    rerender({ ready: true, value: 'valid', savable: true });
    await act(async () => { vi.advanceTimersByTime(25); });
    expect(saves).toBe(1);
  });

  it('serializes a queued latest edit and retries a failed save', async () => {
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
    act(() => { result.current.retry(); });
    await act(async () => {});
    expect(saves).toEqual(['first', 'latest', 'retry-me', 'retry-me']);
    expect(result.current.status).toBe('saved');
  });
});

describe('registry AutoSaveStatus contract', () => {
  const cases: { status: AutoSaveStatusProps['status']; text?: string; role: 'status' | 'alert' }[] = [
    { status: 'idle', role: 'status' },
    { status: 'saving', text: 'Saving…', role: 'status' },
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
    render(<AutoSaveStatus status="error" onRetry={retry} />);
    const button = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledOnce();
  });
});
