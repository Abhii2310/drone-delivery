import { Tile3DLayer } from '@deck.gl/geo-layers'
import type { Layer } from '@deck.gl/core'

// Google Photorealistic 3D Tiles, published through Cesium ion as an external asset.
// deck.gl already ships the 3D Tiles loader, so this rides on the existing MapboxOverlay
// rather than pulling CesiumJS in beside MapLibre.
const ION_ASSET = 2275207
const ION_TOKEN = (import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined)?.trim()

// Google references its tiles to the ellipsoid, so the ground under the city fixture
// origin arrives 910 m up (open-meteo elevation at 12.9716, 77.5946). Every other layer
// in SkyGuard treats z = 0 as ground, so the tileset is pulled down to meet that.
const GROUND_M = 910

export const photorealConfigured = Boolean(ION_TOKEN)

type Endpoint = { url: string; key: string }

// the imagery quota is shared and can run out mid-session; when it does the layer is
// dropped rather than left retrying, so a failing basemap never costs the fleet its frames
const ERROR_BUDGET = 8

let endpoint: Endpoint | null = null
let request: Promise<Endpoint | null> | null = null
let layer: Layer | null = null
let attribution = ''
let failure: string | null = null
let errors = 0

export const photorealAttribution = () => attribution
export const photorealFailure = () => failure

async function resolveEndpoint(): Promise<Endpoint | null> {
  try {
    const res = await fetch(`https://api.cesium.com/v1/assets/${ION_ASSET}/endpoint?access_token=${ION_TOKEN}`)
    if (!res.ok) {
      failure = `Cesium ion refused the token (HTTP ${res.status})`
      return null
    }
    const body = (await res.json()) as { url?: string; options?: { url?: string } }
    const raw = body.options?.url ?? body.url
    if (!raw) {
      failure = 'Cesium ion returned no tileset URL'
      return null
    }
    // the key travels as a header, which is what the tile loader propagates to children
    const parsed = new URL(raw)
    const key = parsed.searchParams.get('key') ?? ''
    parsed.searchParams.delete('key')
    // preflight the root so a spent quota reports itself once instead of through deck's
    // retry loop, which reissues the request on every frame
    const probe = await fetch(parsed.toString(), { headers: { 'X-GOOG-API-KEY': key } })
    if (!probe.ok) {
      failure =
        probe.status === 429
          ? 'imagery quota exhausted (HTTP 429)'
          : `imagery unavailable (HTTP ${probe.status})`
      return null
    }
    return { url: parsed.toString(), key }
  } catch (err) {
    failure = err instanceof Error ? err.message : 'Cesium ion unreachable'
    return null
  }
}

type TileContent = { cartographicOrigin?: number[] & { grounded?: boolean } }

/** Returns the photoreal basemap layer, or nothing while it is off or still resolving. */
export function photorealLayers(enabled: boolean): Layer[] {
  if (!enabled || !ION_TOKEN) return []
  if (errors >= ERROR_BUDGET) return []
  if (!endpoint) {
    request ??= resolveEndpoint().then((e) => {
      endpoint = e
      return e
    })
    return []
  }
  layer ??= new Tile3DLayer({
    id: 'photoreal-city',
    data: endpoint.url,
    loadOptions: { fetch: { headers: { 'X-GOOG-API-KEY': endpoint.key } } },
    pickable: false,
    onTileLoad: (tile: { content?: unknown }) => {
      const origin = (tile.content as TileContent | undefined)?.cartographicOrigin
      if (origin && !origin.grounded) {
        origin[2] -= GROUND_M
        origin.grounded = true
      }
    },
    onTilesetLoad: (tileset: {
      credits?: { attributions?: string[] }
      options: Record<string, unknown>
    }) => {
      attribution = tileset.credits?.attributions?.join(' · ') ?? 'Google'
      // a control room needs the frame budget more than it needs another level of detail,
      // and the tileset coarsens itself rather than filling GPU memory
      tileset.options.maximumScreenSpaceError = 20
      tileset.options.maximumMemoryUsage = 400
      tileset.options.memoryAdjustedScreenSpaceError = true
    },
    onTileError: (_tile: unknown, _url: string, message: string) => {
      failure = message
      if (++errors >= ERROR_BUDGET) layer = null
    },
  })
  return [layer]
}
