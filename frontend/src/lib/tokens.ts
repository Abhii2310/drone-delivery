const cache = new Map<string, string>()

export function token(name: string): string {
  const hit = cache.get(name)
  if (hit) return hit
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!value) throw new Error(`design token ${name} is not defined in index.css`)
  cache.set(name, value)
  return value
}

export type Rgb = [number, number, number]

export function tokenRgb(name: string): Rgb {
  const hex = token(name)
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`token ${name} is not a 6-digit hex colour: ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
