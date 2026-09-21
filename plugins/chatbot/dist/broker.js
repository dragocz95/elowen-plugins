export class TurnEventBroker {
    onError;
    subscribers = new Map();
    /** A subscriber's failure is reported here rather than thrown: a reader that broke must not fail the
     *  turn that produced the event, exactly as a detaching observer never aborts a host relay. */
    constructor(onError) {
        this.onError = onError;
    }
    /** Register one reader for a turn. The returned function detaches it and is safe to call twice. */
    subscribe(turnId, wake) {
        const listeners = this.subscribers.get(turnId) ?? new Set();
        listeners.add(wake);
        this.subscribers.set(turnId, listeners);
        return () => {
            listeners.delete(wake);
            if (listeners.size === 0)
                this.subscribers.delete(turnId);
        };
    }
    /** Announce that `turnId` has new durable events. Called ONLY after the append committed. */
    publish(turnId) {
        for (const wake of [...(this.subscribers.get(turnId) ?? [])]) {
            try {
                wake();
            }
            catch (error) {
                this.subscribers.get(turnId)?.delete(wake);
                this.onError(`chatbot: a public stream subscriber for turn ${turnId} failed and was detached: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
}
