// background.js — service worker

const CHZZK_API = 'https://api.chzzk.naver.com'
const VIDEOHUB_API = 'https://api-videohub.naver.com'

async function getNidCookies() {
  const [aut, ses] = await Promise.all([
    chrome.cookies.get({ url: 'https://chzzk.naver.com', name: 'NID_AUT' }),
    chrome.cookies.get({ url: 'https://chzzk.naver.com', name: 'NID_SES' })
  ])
  return { nidAut: aut?.value || '', nidSes: ses?.value || '' }
}

async function apiGet(url, nidAut, nidSes) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://chzzk.naver.com/',
    'Accept': 'application/json'
  }
  if (nidAut && nidSes) headers['Cookie'] = `NID_AUT=${nidAut}; NID_SES=${nidSes}`

  const res = await fetch(url, { headers })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// ── Clip ──────────────────────────────────────────────────────────────
async function resolveClip(clipId) {
  const { nidAut, nidSes } = await getNidCookies()

  if (!nidAut || !nidSes) {
    throw new Error('치지직에 로그인되어 있지 않습니다. Chrome에서 chzzk.naver.com에 로그인해주세요.')
  }

  // Step 1: clip detail → videoId
  const clipJson = await apiGet(
    `${CHZZK_API}/service/v1/clips/${clipId}/detail?optionalProperties=OWNER_CHANNEL`,
    nidAut, nidSes
  )
  const content = clipJson.content
  if (!content) throw new Error('클립 정보를 불러오지 못했습니다.')
  if (!content.videoId) throw new Error(`videoId 없음. 키: ${Object.keys(content).join(', ')}`)

  // Step 2: videohub → direct MP4 list
  const hubJson = await apiGet(
    `${VIDEOHUB_API}/shortformhub/feeds/v3/card?serviceType=CHZZK&seedMediaId=${content.videoId}&mediaType=VOD`,
    nidAut, nidSes
  )
  if (hubJson?.card?.content?.error) throw new Error(`Videohub 오류: ${JSON.stringify(hubJson.card.content.error)}`)

  const list = hubJson?.card?.content?.vod?.playback?.videos?.list
  if (!list?.length) throw new Error('스트림 URL을 찾지 못했습니다.')

  const streams = [...list]
    .filter(v => v.source)
    .sort((a, b) => (b.encodingOption?.height || 0) - (a.encodingOption?.height || 0))

  return {
    title: content.clipTitle,
    channelName: content.optionalProperty?.ownerChannel?.channelName || '',
    duration: content.duration || 0,
    thumbnailUrl: content.thumbnailImageUrl || '',
    streams
  }
}

// ── VOD ───────────────────────────────────────────────────────────────
async function resolveVod(videoNo) {
  const { nidAut, nidSes } = await getNidCookies()

  const json = await apiGet(`${CHZZK_API}/service/v2/videos/${videoNo}`, nidAut, nidSes)
  const content = json.content
  if (!content) throw new Error('VOD 정보를 불러오지 못했습니다.')

  return {
    title: content.videoTitle,
    channelName: content.channel?.channelName || '',
    duration: content.duration || 0,
    thumbnailUrl: content.thumbnailImageUrl || '',
    videoId: content.videoId,
    inKey: content.inKey,
    vodStatus: content.vodStatus
  }
}

// ── Channel Clips (구독자 포함 모든 클립) ─────────────────────────────
// cursor: clipUID of the boundary item for next page (null = first page)
async function getChannelClips(channelId, cursor = null, size = 20) {
  const { nidAut, nidSes } = await getNidCookies()

  // Confirmed endpoint: /service/v1/channels/{channelId}/clips
  // Cursor pagination: ?next={clipUID}
  let url = `${CHZZK_API}/service/v1/channels/${channelId}/clips?size=${size}`
  if (cursor) url += `&next=${cursor}`

  const json = await apiGet(url, nidAut, nidSes)
  const content = json.content || {}
  const nextCursor = content.page?.next?.clipUID || null

  return {
    clips: content.data || [],
    nextCursor,
    hasNext: !!nextCursor
  }
}

// ── Channel Info ──────────────────────────────────────────────────────
async function getChannelInfo(channelId) {
  const { nidAut, nidSes } = await getNidCookies()
  const json = await apiGet(`${CHZZK_API}/service/v1/channels/${channelId}`, nidAut, nidSes)
  return json.content || null
}

// ── Live ──────────────────────────────────────────────────────────────
async function getLiveDetail(channelId) {
  const { nidAut, nidSes } = await getNidCookies()
  const json = await apiGet(`${CHZZK_API}/service/v2/channels/${channelId}/live-detail`, nidAut, nidSes)
  const c = json.content
  if (!c) throw new Error('라이브 정보를 불러오지 못했습니다.')
  return c
}

async function startLiveRecord(channelId) {
  const { nidAut, nidSes } = await getNidCookies()
  const r = await fetch(`${LOCAL_SERVER}/api/start-live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId, nidAut, nidSes })
  })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error(j.error || `서버 오류 (${r.status})`)
  }
  return r.json()
}

async function stopLiveRecord(token) {
  const r = await fetch(`${LOCAL_SERVER}/api/stop-live/${token}`, { method: 'POST' })
  return r.json()
}

// ── Download clip via chrome.downloads ────────────────────────────────
async function downloadClip(clipId, quality) {
  const info = await resolveClip(clipId)
  let selected = info.streams[0]

  if (quality !== 'best') {
    const target = parseInt(quality, 10)
    selected = info.streams.find(s => s.encodingOption?.height === target)
      || info.streams.find(s => (s.encodingOption?.height || 0) <= target)
      || info.streams[0]
  }

  const safeTitle = (info.title || 'clip').replace(/[\\/:*?"<>|\n]/g, '').trim() || 'clip'
  const dlId = await chrome.downloads.download({
    url: selected.source,
    filename: `${safeTitle}.mp4`,
    conflictAction: 'uniquify'
  })

  return { title: info.title, height: selected.encodingOption?.height, downloadId: dlId }
}

// ── VOD via local server ──────────────────────────────────────────────
const LOCAL_SERVER = 'http://localhost:5555'
const activeVodDownloads = new Map() // url -> token

async function isServerRunning() {
  try {
    const r = await fetch(`${LOCAL_SERVER}/`, { method: 'HEAD' })
    return r.ok || r.status < 500
  } catch { return false }
}

async function startVodDownload(url, soopUsername = '', soopPassword = '') {
  const { nidAut, nidSes } = await getNidCookies()
  const r = await fetch(`${LOCAL_SERVER}/api/start-vod`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, nidAut, nidSes, soopUsername, soopPassword })
  })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error(j.error || `서버 오류 (${r.status})`)
  }
  const res = await r.json()  // { token }
  if (res?.token) {
    activeVodDownloads.set(url, res.token)
  }
  return res
}

async function getVodStatus(token) {
  const r = await fetch(`${LOCAL_SERVER}/api/vod-status/${token}`)
  if (!r.ok) throw new Error(`상태 조회 실패 (${r.status})`)
  return r.json()  // { status, progress, log, fileToken, error }
}

// ── Message router ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    try {
      switch (msg.action) {
        case 'getCookies':      return await getNidCookies()
        case 'resolveClip':     return await resolveClip(msg.clipId)
        case 'resolveVod':      return await resolveVod(msg.videoNo)
        case 'getChannelClips': return await getChannelClips(msg.channelId, msg.cursor, msg.size)
        case 'getChannelInfo':  return await getChannelInfo(msg.channelId)
        case 'downloadClip':    return await downloadClip(msg.clipId, msg.quality || 'best')
        case 'isServerRunning': return { running: await isServerRunning() }
        case 'startVodDownload': return await startVodDownload(msg.url, msg.soopUsername, msg.soopPassword)
        case 'getVodStatus':    return await getVodStatus(msg.token)
        case 'getLiveDetail':   return await getLiveDetail(msg.channelId)
        case 'startLiveRecord': return await startLiveRecord(msg.channelId)
        case 'stopLiveRecord':  return await stopLiveRecord(msg.token)
        case 'getActiveDownload': return { token: activeVodDownloads.get(msg.url) || null }
        case 'clearActiveDownload':
          activeVodDownloads.delete(msg.url)
          return { success: true }
        default: throw new Error(`Unknown action: ${msg.action}`)
      }
    } catch (err) {
      return { error: err.message, status: err.status }
    }
  })().then(sendResponse)
  return true
})
