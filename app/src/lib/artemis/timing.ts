export function nowMs(): number {
  return performance.now();
}

export function isoNow(): string {
  return new Date().toISOString();
}

export async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const h = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(h);
        resolve(v);
      },
      (err) => {
        clearTimeout(h);
        reject(err);
      }
    );
  });
}