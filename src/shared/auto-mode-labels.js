export function normalizeAutoModeLabel(value) {
    return value.trim().toLowerCase();
}
export function appendAutoModeLabel(current, raw) {
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
