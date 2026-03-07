export function normalizeAutoModeLabel(value: string): string {
  return value.trim().toLowerCase();
}

export function appendAutoModeLabel(current: string[], raw: string): string[] {
  const label = normalizeAutoModeLabel(raw);
  if (!label) {
    return [...current];
  }

  const existing = new Set(current.map(normalizeAutoModeLabel));
  if (existing.has(label)) {
    return [...current];
  }

  return [...current, label];
}
