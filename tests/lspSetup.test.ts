// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { registerLspSetup } from '../plugins/lsp/src/setup.js';

interface RegisteredStep {
  id: string;
  run: (ctx: never) => Promise<{ status: string; summary?: string }>;
}

const setupContext = (request: ReturnType<typeof vi.fn>) => ({
  request,
  note: vi.fn(),
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn() },
  select: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
});

describe('lsp setup contribution', () => {
  it('registers the stable LSP setup step without importing wizard internals', () => {
    const steps: RegisteredStep[] = [];
    registerLspSetup({ registerSetupStep: (step: RegisteredStep) => steps.push(step) } as never);
    expect(steps.map((step) => step.id)).toEqual(['lsp']);
  });

  it('reports an unavailable daemon without claiming an install', async () => {
    const steps: RegisteredStep[] = [];
    registerLspSetup({ registerSetupStep: (step: RegisteredStep) => steps.push(step) } as never);
    const request = vi.fn(async () => ({ ok: false, status: 503, data: null }));
    const ctx = setupContext(request);
    const result = await steps[0]!.run(ctx as never);
    expect(result).toEqual({ status: 'skipped', summary: 'not installed' });
    expect(ctx.log.warn).toHaveBeenCalledWith(expect.stringContaining('disabled'));
    expect(ctx.select).not.toHaveBeenCalled();
  });
});
