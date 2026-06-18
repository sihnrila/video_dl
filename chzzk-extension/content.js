// content.js — runs on chzzk.naver.com pages
// Detects page type and notifies popup via storage

function parsePage() {
  const url = location.href
  const path = location.pathname

  if (/soop\.com|sooplive\.com|sooplive\.co\.kr/.test(url)) {
    return { type: 'soop', url }
  }

  // /clips/{clipId}
  const clipMatch = path.match(/^\/clips\/([A-Za-z0-9_-]+)/)
  if (clipMatch) return { type: 'clip', clipId: clipMatch[1] }

  // /video/{videoNo}
  const vodMatch = path.match(/^\/video\/(\w+)/)
  if (vodMatch) return { type: 'vod', videoNo: vodMatch[1] }

  // /{channelId}/clip  or  /{channelId}/video  or  /{channelId}
  // Channel IDs are 32-char hex hashes
  const channelMatch = path.match(/^\/([0-9a-f]{32})(\/.*)?$/)
  if (channelMatch) {
    const channelId = channelMatch[1]
    const sub = channelMatch[2] || ''
    const subType = sub.startsWith('/clip') ? 'clips'
      : sub.startsWith('/video') ? 'videos'
      : 'home'
    return { type: 'channel', channelId, subType }
  }

  return { type: 'other' }
}

// Send page info to popup whenever URL changes (SPA navigation)
function broadcastPageInfo() {
  const info = parsePage()
  chrome.storage.session.set({ pageInfo: info })
}

broadcastPageInfo()

// Watch for SPA URL changes
let lastHref = location.href
const observer = new MutationObserver(() => {
  if (location.href !== lastHref) {
    lastHref = location.href
    broadcastPageInfo()
  }
})
observer.observe(document.body, { subtree: true, childList: true })
