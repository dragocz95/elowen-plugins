export const SYSTEM_CLOCK = {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new Error('Operation aborted.'));
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason ?? new Error('Operation aborted.'));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        timer.unref?.();
        signal?.addEventListener('abort', onAbort, { once: true });
    }),
};
