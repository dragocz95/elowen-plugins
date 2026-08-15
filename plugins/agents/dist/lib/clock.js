export class SystemClock {
    now() { return Date.now(); }
    setInterval(fn, ms) {
        const h = setInterval(fn, ms);
        return () => clearInterval(h);
    }
}
