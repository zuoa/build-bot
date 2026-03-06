function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

export function normalizeVisibleLogText(text: string): string {
  return stripAnsi(text)
    .normalize('NFKC')
    .replace(/.\x08/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildLogDedupKey(text: string): string {
  return normalizeVisibleLogText(text)
    .replace(/[`"'“”‘’]/g, '')
    .toLowerCase();
}
