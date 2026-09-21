/** Live wake-up fan-out over one turn's public event log.
 *
 *  It deliberately carries NO payload. A subscriber is woken and then reads the durable log from its own
 *  cursor, which makes "written before it was announced" a property of the code rather than a convention:
 *  the only thing a wake-up can ever say is that MORE durable rows exist. A client that disconnected
 *  mid-answer therefore cannot lose an event, a second subscriber cannot receive a different projection
 *  than the first, and a daemon restart cannot roll back something a widget already rendered.
 *
 *  The broker holds nothing durable and nothing survives a process: reconnect is served by the plugin's own
 *  tables, never by this map. */
export type TurnEventWake = () => void;

export class TurnEventBroker {
  private readonly subscribers = new Map<string, Set<TurnEventWake>>();

  /** A subscriber's failure is reported here rather than thrown: a reader that broke must not fail the
   *  turn that produced the event, exactly as a detaching observer never aborts a host relay. */
  constructor(private readonly onError: (message: string) => void) {}

  /** Register one reader for a turn. The returned function detaches it and is safe to call twice. */
  subscribe(turnId: string, wake: TurnEventWake): () => void {
    const listeners = this.subscribers.get(turnId) ?? new Set<TurnEventWake>();
    listeners.add(wake);
    this.subscribers.set(turnId, listeners);
    return () => {
      listeners.delete(wake);
      if (listeners.size === 0) this.subscribers.delete(turnId);
    };
  }

  /** Announce that `turnId` has new durable events. Called ONLY after the append committed. */
  publish(turnId: string): void {
    for (const wake of [...(this.subscribers.get(turnId) ?? [])]) {
      try {
        wake();
      } catch (error) {
        this.subscribers.get(turnId)?.delete(wake);
        this.onError(`chatbot: a public stream subscriber for turn ${turnId} failed and was detached: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
