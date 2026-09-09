import { Tile3DLayer } from '@deck.gl/geo-layers'
import type { Layer } from '@deck.gl/core'

// Google Photorealistic 3D Tiles, published through Cesium ion as an external asset and
// rendered by deck.gl's own 3D Tiles layer inside the existing MapboxOverlay. CesiumJS is
// not used: the token buys the imagery, not the engine.
const ION_ASSET = 2275207

// VITE_CESIUM_ION_TOKEN accepts several tokens separated by commas or whitespace. Each
// retry advances to the next one, so a revoked token falls through to the next. Note that
// ion hands every token of an account the same shared Google key, so extra tokens buy
// resilience against revocation, not extra imagery quota.
const TOKENS = ((import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined) ?? '')
  .split(/[\s,]+/)
  .map((t) => t.trim())
  .filter(Boolean)

// Google references its tiles to the ellipsoid, so the ground under the city fixture
// origin arrives 910 m up (open-meteo elevation at 12.9716, 77.5946). Every other layer
// in SkyGuard treats z = 0 as ground, so the tileset is pulled down to meet that.
const GROUND_M = 910

// multiplied into every texel, which is how daylight photography is pulled down to the
// graphite the rest of the console lives in. Raise it to brighten the city.
const TINT: [number, number, number, number] = [30, 36, 46, 255]
let tint = TINT

// the shared key refuses in bursts, so requests are throttled on the way out and a refusal
// is retried with a growing backoff rather than latched. A single 429 is not an outage.
const MAX_REQUESTS = 6
const TILESET_TIMEOUT_MS = 12000
const RETRY_MS = 5000
const RETRY_MAX_MS = 40000
const ERROR_BUDGET = 24

export const photorealConfigured = TOKENS.length > 0
export const photorealTokenCount = TOKENS.length

type Endpoint = { url: string; key: string; tokenIndex: number }

let endpoint: Endpoint | null = null
let request: Promise<Endpoint | null> | null = null
let layer: Layer | null = null
let builtAt = 0
let drawn = 0
let attribution = ''
let failure: string | null = null
let errors = 0
let retryAfter = 0
let backoff = RETRY_MS
let cursor = 0

export const photorealAttribution = () => attribution
export const photorealFailure = () => failure
export const photorealTokenInUse = () => (endpoint ? endpoint.tokenIndex + 1 : 0)
/** True only once imagery is actually on screen, which is what the basemap switch waits on. */
export const photorealReady = () => drawn > 0

/** Rebuilds the tileset at a new tint. Exposed for tuning the city against a projector. */
export function setPhotorealTint(rgb: [number, number, number]): void {
  tint = [rgb[0], rgb[1], rgb[2], 255]
  layer = null
}

/** Drops the tileset so the next frame rebuilds it against the next token in the pool. */
function recycle(reason: string): void {
  failure = reason
  layer = null
  endpoint = null
  request = null
  drawn = 0
  errors = 0
  cursor = (cursor + 1) % Math.max(TOKENS.length, 1)
  // the shared key refuses in bursts, so backing off harder each time beats hammering it
  retryAfter = Date.now() + backoff
  backoff = Math.min(backoff * 2, RETRY_MAX_MS)
}

async function resolveEndpoint(): Promise<Endpoint | null> {
  // start at the cursor so each retry leads with a different token
  for (let n = 0; n < TOKENS.length; n++) {
    const index = (cursor + n) % TOKENS.length
    try {
      const res = await fetch(`https://api.cesium.com/v1/assets/${ION_ASSET}/endpoint?access_token=${TOKENS[index]}`)
      if (!res.ok) {
        failure = `token ${index + 1} refused by Cesium ion (HTTP ${res.status})`
        continue
      }
      const body = (await res.json()) as { url?: string; options?: { url?: string } }
      const raw = body.options?.url ?? body.url
      if (!raw) {
        failure = `token ${index + 1} returned no tileset URL`
        continue
      }
      // the key travels as a header, which is what the tile loader propagates to children
      const parsed = new URL(raw)
      const key = parsed.searchParams.get('key') ?? ''
      parsed.searchParams.delete('key')
      failure = null
      return { url: parsed.toString(), key, tokenIndex: index }
    } catch (err) {
      failure = err instanceof Error ? err.message : `token ${index + 1} unreachable`
    }
  }
  if (!failure) failure = 'imagery unavailable on every token'
  return null
}

type TileContent = { cartographicOrigin?: number[] & { grounded?: boolean } }

function build(resolved: Endpoint): Layer {
  builtAt = Date.now()
  drawn = 0
  return new Tile3DLayer({
    id: 'photoreal-city',
    data: resolved.url,
    loadOptions: { fetch: { headers: { 'X-GOOG-API-KEY': resolved.key } } },
    pickable: false,
    _subLayerProps: { scenegraph: { getColor: tint } },
    onTileLoad: (tile: { content?: unknown }) => {
      const origin = (tile.content as TileContent | undefined)?.cartographicOrigin
      if (origin && !origin.grounded) {
        origin[2] -= GROUND_M
        origin.grounded = true
      }
      drawn++
      errors = 0
      failure = null
      backoff = RETRY_MS
    },
    onTilesetLoad: (tileset: { credits?: { attributions?: string[] }; options: Record<string, unknown> }) => {
      attribution = tileset.credits?.attributions?.join(' · ') ?? 'Google'
      // a control room needs the frame budget more than another level of detail, and a
      // capped request queue is what keeps the shared key out of its burst limit
      tileset.options.maximumScreenSpaceError = 20
      tileset.options.maximumMemoryUsage = 400
      tileset.options.memoryAdjustedScreenSpaceError = true
      tileset.options.throttleRequests = true
      tileset.options.maxRequests = MAX_REQUESTS
    },
    onTileError: (_tile: unknown, _url: string, message: string) => {
      failure = message
      if (++errors >= ERROR_BUDGET) recycle('imagery failing, reconnecting')
    },
  }) as unknown as Layer
}

/** Returns the photoreal city layer, or nothing while it is off, retrying or unavailable. */
export function photorealLayers(enabled: boolean): Layer[] {
  if (!enabled || TOKENS.length === 0) return []
  if (Date.now() < retryAfter) return []
  if (!endpoint) {
    request ??= resolveEndpoint().then((e) => {
      endpoint = e
      if (!e) {
        request = null
        retryAfter = Date.now() + backoff
        backoff = Math.min(backoff * 2, RETRY_MAX_MS)
      }
      return e
    })
    return []
  }
  if (!layer) {
    layer = build(endpoint)
    return [layer]
  }
  // the tileset root can be refused without any tile ever erroring, which leaves a layer
  // that will never draw; a watchdog rebuilds it against the next token instead
  if (drawn === 0 && Date.now() - builtAt > TILESET_TIMEOUT_MS) {
    recycle('imagery throttled, retrying')
    return []
  }
  return [layer]
}
