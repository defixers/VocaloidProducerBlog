const syncUrl = import.meta.env.VITE_BILIBILI_SYNC_URL || '/api/bilibili/feed'

export async function fetchBilibiliFeed() {
  const response = await fetch(syncUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) throw new Error(`Bilibili sync failed: ${response.status}`)
  const data = await response.json()

  return {
    videos: Array.isArray(data.videos) ? data.videos : [],
    dynamics: Array.isArray(data.dynamics) ? data.dynamics : [],
    syncedAt: data.syncedAt || new Date().toISOString(),
    stale: Boolean(data.stale),
    unavailable: Boolean(data.unavailable),
    videoUnavailable: Boolean(data.videoUnavailable),
    dynamicUnavailable: Boolean(data.dynamicUnavailable),
    videoStale: Boolean(data.videoStale || data.stale),
    dynamicStale: Boolean(data.dynamicStale || data.stale),
  }
}
