const cache = new Map<string, string>()

export function token(name: string): string {
  const hit = cache.get(name)
  if (hit) return hit
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!value) throw new Error(`design token ${name} is not defined in index.css`)
  cache.set(name, value)
  return value
}
