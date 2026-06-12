/**
 * Helpers de red: timeouts y logging leve.
 */
export function withTimeout<T>(p: Promise<T>, ms = 8000, label?: string): Promise<T> {
  const start = performance.now();
  console.debug(`[withTimeout] start ${label ?? 'operation'} @ ${new Date().toISOString()}`);

  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      const duration = Math.round(performance.now() - start);
      const msg = `[withTimeout] timeout ${ms}ms${label ? ` - ${label}` : ''} (after ${duration}ms)`;
      console.error(msg);
      reject(new Error(msg));
    }, ms);

    p.then((value) => {
      window.clearTimeout(timeoutId);
      const duration = Math.round(performance.now() - start);
      console.debug(`[withTimeout] success ${label ?? 'operation'} in ${duration}ms`);
      resolve(value);
    }).catch((err) => {
      window.clearTimeout(timeoutId);
      const duration = Math.round(performance.now() - start);
      console.error(`[withTimeout] error ${label ?? 'operation'} in ${duration}ms:`, err);
      reject(err);
    });
  });
}
