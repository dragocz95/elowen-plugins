/** The work bundle's mission flow — the epic's phase timeline.
 *
 *  This view's data plane is stubbed rather than served, because what is under test is how the phase
 *  rows are composed, not which endpoint they came from. Only the hooks the view reads are replaced;
 *  the rest of each host module stays real, because the runtime is built from ALL of it and a bare
 *  object would leave the bundle without half its contract. (The core copy of this suite stubbed
 *  web/lib/queries and web/lib/elowenClient the same way — these are the same modules, re-homed.)
 *
 *  It lives in its own file for the same reason: the stubs are module-wide, and any other panel sharing
 *  the file would silently read them too.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createWrapper } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';

vi.mock('./ui/hostHooks', async (orig) => ({
  ...(await orig() as object),
  useSessions: () => ({ data: [] }),
  useSessionSignals: () => ({}),
  useConfig: () => ({ data: { defaults: { exec: 'sonnet' } } }),
  useAgentsPlugin: () => true, // the status dots render only with the agents plugin present
}));
vi.mock('./ui/hostClient', async (orig) => ({
  ...(await orig() as object),
  elowenClient: { taskUsage: vi.fn().mockResolvedValue(null) },
}));

ensurePluginUiRuntime();
const { MissionFlow } = await import('../plugins/work/web-src/tasks/MissionFlow');

import type { Task } from '../plugins/work/web-src/types';

const epic: Task = { id: 'ep1', title: 'Ship the dashboard', type: 'epic', status: 'in_progress' };
const phases: Task[] = [
  { id: 'p1', title: 'Scaffold API', type: 'task', status: 'closed', outcome: 'ok', parent_id: 'ep1', labels: ['exec:sonnet', 'agent:Nova'] },
  { id: 'p2', title: 'Wire the UI', type: 'task', status: 'in_progress', parent_id: 'ep1', labels: ['exec:opus', 'agent:Juno'] },
  { id: 'p3', title: 'Polish', type: 'task', status: 'open', parent_id: 'ep1', labels: [] },
];

function renderFlow(props: Partial<Parameters<typeof MissionFlow>[0]> = {}) {
  const { wrapper: Wrapper } = createWrapper();
  return render(<Wrapper><MissionFlow epic={epic} phases={phases} onSelectPhase={() => {}} {...props} /></Wrapper>);
}

describe('MissionFlow', () => {
  it('renders the mission header and every phase with its agent', () => {
    renderFlow();
    expect(screen.getByText('Ship the dashboard')).toBeTruthy();
    expect(screen.getByText('Scaffold API')).toBeTruthy();
    expect(screen.getByText('Wire the UI')).toBeTruthy();
    expect(screen.getByText('Polish')).toBeTruthy();
    expect(screen.getByText('Nova')).toBeTruthy(); // agent name shown on its phase row
    expect(screen.getByText('Juno')).toBeTruthy();
  });

  it('shows the phase-count metric pill', () => {
    renderFlow();
    expect(screen.getByText(/phases|fází/)).toBeTruthy(); // "3 phases" pill
  });

  it('shows the full mission summary below the timeline when the epic is closed', () => {
    const closedEpic: Task = { ...epic, status: 'closed', outcome: 'ok', result_summary: 'Shipped the dashboard and wired the UI.' };
    renderFlow({ epic: closedEpic });
    expect(screen.getByText('Shipped the dashboard and wired the UI.')).toBeTruthy();
  });

  it('omits the summary while the mission is still in progress', () => {
    renderFlow();
    expect(screen.queryByText(/result|summary|výsledek|shrnutí/i)).toBeNull();
  });

  it('calls onSelectPhase with the phase id when a phase card is clicked', () => {
    const onSelectPhase = vi.fn();
    renderFlow({ onSelectPhase });
    fireEvent.click(screen.getByText('Wire the UI'));
    expect(onSelectPhase).toHaveBeenCalledWith('p2');
  });

  it('calls onContextMenu with the task on right-click of a phase card', () => {
    const onContextMenu = vi.fn();
    renderFlow({ onContextMenu });
    fireEvent.contextMenu(screen.getByText('Polish'));
    expect(onContextMenu).toHaveBeenCalled();
    expect(onContextMenu.mock.calls[0]![1]).toMatchObject({ id: 'p3' });
  });
});
