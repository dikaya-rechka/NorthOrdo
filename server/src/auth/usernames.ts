export function normalizeUsername(value: string): string | null {
  const normalized = value.normalize('NFKC').trim().toLowerCase()
  if ([...normalized].length < 3 || [...normalized].length > 64 || /[\s\p{Cc}]/u.test(normalized)) {
    return null
  }

  return normalized
}
