export function styleKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

// Tolérance de faute de frappe selon la longueur (aucune pour les mots très courts)
export function typoTolerance(key: string): number {
  if (key.length <= 4) return 0;
  return key.length <= 8 ? 1 : 2;
}

export function findClosestStyle<T extends { key: string }>(key: string, styles: T[]): T | undefined {
  const exact = styles.find((s) => s.key === key);
  if (exact) return exact;
  const tolerance = typoTolerance(key);
  if (tolerance === 0) return undefined;
  let best: T | undefined;
  let bestDistance = tolerance + 1;
  for (const style of styles) {
    if (Math.abs(style.key.length - key.length) > tolerance) continue;
    const distance = levenshtein(key, style.key);
    if (distance < bestDistance) {
      best = style;
      bestDistance = distance;
    }
  }
  return best;
}
