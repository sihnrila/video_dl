// popup.js

const bg = msg => new Promise(resolve => chrome.runtime.sendMessage(msg, resolve))
const $ = id => document.getElementById(id)
const fmtDur = s => s ? `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}` : ''

let currentPageInfo = null
let currentClipInfo = null
let clipsCursor = null   // clipUID cursor for next page
let clipsChannelId = null
let clipsHasNext = false
let totalLoaded = 0

// ── Tabs ──────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
    tab.classList.add('active')
    $(`tab-${tab.dataset.tab}`).classList.add('active')
  })
})

// ── Auth badge ────────────────────────────────────────────────────────
async function checkAuth() {
  const { nidAut, nidSes } = await bg({ action: 'getCookies' })
  const ok = !!(nidAut && nidSes)
  $('authBadge').className = `auth-badge ${ok ? 'ok' : 'fail'}`
  $('authDot').className = `auth-dot ${ok ? 'ok' : 'fail'}`
  $('authText').textContent = ok ? '로그인됨' : '로그인 필요'
  return ok
}

// ── Status helpers ────────────────────────────────────────────────────
function showStatus(msg, type = 'info') {
  const el = $('dlStatus')
  el.textContent = msg
  el.className = `status-bar ${type}`
  el.style.display = 'block'
}
function hideStatus() { $('dlStatus').style.display = 'none' }

function isSoopUrl(url) {
  return /soop\.com|sooplive\.com|sooplive\.co\.kr/.test(url)
}

// ── SOOP credentials (chrome.storage.local, auto-login) ────────────────
async function loadSoopCreds() {
  const { soop_username = '', soop_password = '' } = await chrome.storage.local.get(['soop_username', 'soop_password'])
  return { soopUsername: soop_username, soopPassword: soop_password }
}
async function saveSoopCreds(soopUsername, soopPassword) {
  await chrome.storage.local.set({ soop_username: soopUsername, soop_password: soopPassword })
}

// ── Tab 1: Current page ───────────────────────────────────────────────
async function loadPageInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url?.includes('chzzk.naver.com') && !isSoopUrl(tab?.url)) {
    show('pageLoading', false); show('pageContent', false); show('pageOther', true)
    return
  }

  // Get page info from content script via storage
  let info = null
  try {
    const stored = await chrome.storage.session.get('pageInfo')
    info = stored.pageInfo
  } catch {}

  if (!info) {
    // Fallback: parse URL directly
    info = parseUrl(tab.url)
  }

  currentPageInfo = info

  // Auto-fill channel ID in clips tab
  if (info.channelId && !$('channelIdInput').value) {
    $('channelIdInput').value = info.channelId
  }

  show('pageLoading', false)

  if (info.type === 'soop') await renderSoopPage(tab.url)
  else if (info.type === 'clip') await renderClipPage(info.clipId)
  else if (info.type === 'vod') await renderVodPage(info.videoNo, tab.url)
  else if (info.type === 'live') await renderLivePage(info.channelId, tab.url)
  else if (info.type === 'channel') renderChannelPage(info.channelId)
  else { show('pageContent', false); show('pageOther', true) }
}

function parseUrl(url) {
  if (isSoopUrl(url)) {
    return { type: 'soop', url }
  }
  const u = new URL(url)
  const path = u.pathname
  const clipM = path.match(/^\/clips\/([A-Za-z0-9_-]+)/)
  if (clipM) return { type: 'clip', clipId: clipM[1] }
  const vodM = path.match(/^\/video\/(\w+)/)
  if (vodM) return { type: 'vod', videoNo: vodM[1] }
  const liveM = path.match(/^\/live\/([0-9a-fA-F]{20,})/i)
  if (liveM) return { type: 'live', channelId: liveM[1] }
  const chM = path.match(/^\/([0-9a-f]{32})(\/.*)?$/)
  if (chM) return { type: 'channel', channelId: chM[1] }
  return { type: 'other' }
}

function show(id, visible) { $(id).style.display = visible ? 'block' : 'none' }
function showFlex(id, visible) { $(id).style.display = visible ? 'flex' : 'none' }

async function renderClipPage(clipId) {
  show('pageContent', true)
  show('clipStreams', false); show('vodInfo', false); show('channelInfo', false)
  $('pageType').textContent = '🎬 클립'
  $('pageType').className = 'page-type clip'
  $('pageTitle').textContent = '클립 정보 불러오는 중...'
  $('pageMeta').textContent = ''

  const result = await bg({ action: 'resolveClip', clipId })
  if (result?.error) {
    showStatus(`❌ ${result.error}`, 'err')
    $('pageTitle').textContent = `클립 ID: ${clipId}`
    return
  }

  currentClipInfo = result
  $('pageTitle').textContent = result.title || clipId
  $('pageMeta').textContent = `${result.channelName || ''}${result.duration ? '  •  ' + fmtDur(result.duration) : ''}`

  if (result.thumbnailUrl) {
    const img = $('thumbnail')
    img.src = result.thumbnailUrl
    img.onload = () => img.classList.add('loaded')
  }

  // Show available qualities
  const badges = $('streamBadges')
  badges.innerHTML = ''
  result.streams.forEach(s => {
    const h = s.encodingOption?.height || '?'
    const b = document.createElement('div')
    b.className = 'stream-badge'
    b.textContent = `${h}p`
    badges.appendChild(b)
  })

  show('clipStreams', true)
  hideStatus()
}

async function renderSoopPage(pageUrl) {
  show('pageContent', true)
  show('clipStreams', false); show('vodInfo', false); show('channelInfo', false); show('liveInfo', false)
  $('pageType').textContent = '🌲 SOOP'
  $('pageType').className = 'page-type vod'
  $('pageTitle').textContent = '숲(SOOP) 방송/VOD 영상'
  $('pageMeta').textContent = pageUrl

  const img = $('thumbnail')
  img.src = ''
  img.classList.remove('loaded')

  const cmd = `yt-dlp --cookies-from-browser chrome "${pageUrl}"`
  $('vodCommand').textContent = cmd

  show('soopAuthInputs', true)
  const { soopUsername, soopPassword } = await loadSoopCreds()
  $('soopUsername').value = soopUsername
  $('soopPassword').value = soopPassword

  const { running } = await bg({ action: 'isServerRunning' })
  $('vodServerStatus').textContent = running
    ? '✅ 서버 연결됨 — 바로 다운로드 가능'
    : '⚠️ 서버 꺼짐 — yt-dlp 명령어를 터미널에서 실행하세요'
  $('vodServerStatus').className = running ? 'vod-server-status ok' : 'vod-server-status warn'
  $('btnDownloadVod').style.display = running ? 'block' : 'none'

  // Resume active download if exists
  const active = await bg({ action: 'getActiveDownload', url: pageUrl })
  if (active?.token) {
    $('btnDownloadVod').disabled = true
    $('btnDownloadVod').textContent = '⏳ 다운로드 중...'
    startVodPoll(active.token)
  }

  show('vodInfo', true)
  hideStatus()
}

let vodPollTimer = null

async function renderVodPage(videoNo, pageUrl) {
  show('pageContent', true)
  show('clipStreams', false); show('vodInfo', false); show('channelInfo', false)
  show('soopAuthInputs', false)
  $('pageType').textContent = '📺 VOD'
  $('pageType').className = 'page-type vod'
  $('pageTitle').textContent = 'VOD 정보 불러오는 중...'
  $('pageMeta').textContent = ''

  const result = await bg({ action: 'resolveVod', videoNo })
  if (result?.error) {
    showStatus(`❌ ${result.error}`, 'err')
    $('pageTitle').textContent = `VOD #${videoNo}`
  } else {
    $('pageTitle').textContent = result.title || `VOD #${videoNo}`
    $('pageMeta').textContent = `${result.channelName || ''}${result.duration ? '  •  ' + fmtDur(result.duration) : ''}`
    if (result.thumbnailUrl) {
      const img = $('thumbnail')
      img.src = result.thumbnailUrl
      img.onload = () => img.classList.add('loaded')
    }
  }

  const cmd = `yt-dlp --cookies-from-browser chrome "${pageUrl}"`
  $('vodCommand').textContent = cmd

  // Check if local server is available
  const { running } = await bg({ action: 'isServerRunning' })
  $('vodServerStatus').textContent = running
    ? '✅ 서버 연결됨 — 바로 다운로드 가능'
    : '⚠️ 서버 꺼짐 — yt-dlp 명령어를 터미널에서 실행하세요'
  $('vodServerStatus').className = running ? 'vod-server-status ok' : 'vod-server-status warn'
  $('btnDownloadVod').style.display = running ? 'block' : 'none'

  // Resume active download if exists
  const active = await bg({ action: 'getActiveDownload', url: pageUrl })
  if (active?.token) {
    $('btnDownloadVod').disabled = true
    $('btnDownloadVod').textContent = '⏳ 다운로드 중...'
    startVodPoll(active.token)
  }

  show('vodInfo', true)
  hideStatus()
}

function startVodPoll(token) {
  if (vodPollTimer) clearInterval(vodPollTimer)
  vodPollTimer = setInterval(async () => {
    const r = await bg({ action: 'getVodStatus', token })
    if (r?.error) {
      clearInterval(vodPollTimer)
      showStatus('❌ 상태 조회 실패', 'err')
      $('btnDownloadVod').disabled = false
      $('btnDownloadVod').textContent = '⬇ VOD 다운로드'
      return
    }
    const pct = Math.round(r.progress || 0)
    $('btnDownloadVod').textContent = `⏳ ${pct}%`
    if (r.log?.length) showStatus(r.log[r.log.length - 1], 'info')

    if (r.status === 'done' && r.fileToken) {
      clearInterval(vodPollTimer)
      showStatus('✅ 다운로드 완료! 저장 중...', 'ok')
      const a = document.createElement('a')
      a.href = `http://localhost:5555/file/${r.fileToken}`
      a.click()
      $('btnDownloadVod').disabled = false
      $('btnDownloadVod').textContent = '⬇ VOD 다운로드'
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.url) bg({ action: 'clearActiveDownload', url: tab.url })
    } else if (r.status === 'error') {
      clearInterval(vodPollTimer)
      showStatus(`❌ ${r.error || '다운로드 실패'}`, 'err')
      $('btnDownloadVod').disabled = false
      $('btnDownloadVod').textContent = '⬇ VOD 다운로드'
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.url) bg({ action: 'clearActiveDownload', url: tab.url })
    }
  }, 2000)
}

let liveRecordToken = null
let livePollTimer = null

async function renderLivePage(channelId, pageUrl) {
  show('pageContent', true)
  show('clipStreams', false); show('vodInfo', false); show('channelInfo', false); show('liveInfo', true)
  $('pageType').textContent = '🔴 라이브'
  $('pageType').className = 'page-type live'
  $('pageTitle').textContent = '라이브 정보 불러오는 중...'
  $('pageMeta').textContent = ''

  const cmd = `yt-dlp --cookies-from-browser chrome -o "live_%(id)s.%(ext)s" "${pageUrl}"`
  $('liveCommand').textContent = cmd

  const { running } = await bg({ action: 'isServerRunning' })

  try {
    const live = await bg({ action: 'getLiveDetail', channelId })
    const isOpen = live.status === 'OPEN'
    $('pageTitle').textContent = live.liveTitle || '방송 제목 없음'
    $('pageMeta').textContent = live.channel?.channelName || ''

    if (live.concurrentUserCount != null) {
      $('pageMeta').textContent += `  •  👥 ${live.concurrentUserCount.toLocaleString()}명 시청 중`
    }

    if (live.liveImageUrl) {
      const img = $('thumbnail')
      img.src = live.liveImageUrl
      img.onload = () => img.classList.add('loaded')
    }

    $('liveStatusBadge').textContent = isOpen ? '🔴 방송 중' : '⚫ 방송 종료'
    $('liveStatusBadge').className = `live-status-badge ${isOpen ? 'on' : 'off'}`

    if (isOpen) {
      $('btnRecordLive').style.display = running ? 'block' : 'none'
      $('liveServerStatus').textContent = running
        ? '✅ 서버 연결됨 — 녹화 시작 가능'
        : '⚠️ 서버 꺼짐 — yt-dlp 명령어를 터미널에서 실행하세요'
      $('liveServerStatus').className = running ? 'vod-server-status ok' : 'vod-server-status warn'
    } else {
      $('btnRecordLive').style.display = 'none'
      $('liveServerStatus').textContent = '방송이 종료되었습니다.'
      $('liveServerStatus').className = 'vod-server-status warn'
    }
  } catch (err) {
    showStatus(`❌ ${err.error || err.message}`, 'err')
    $('pageTitle').textContent = '라이브 정보 없음'
    $('liveStatusBadge').textContent = '확인 실패'
    $('liveStatusBadge').className = 'live-status-badge off'
    $('btnRecordLive').style.display = running ? 'block' : 'none'
    $('liveServerStatus').textContent = running ? '✅ 서버 연결됨' : '⚠️ 서버 꺼짐'
    $('liveServerStatus').className = running ? 'vod-server-status ok' : 'vod-server-status warn'
  }

  hideStatus()

  $('liveChannelId').value = channelId
}

function renderChannelPage(channelId) {
  show('pageContent', true)
  show('clipStreams', false); show('vodInfo', false)
  $('pageType').textContent = '📡 채널'
  $('pageType').className = 'page-type channel'
  $('pageTitle').textContent = '채널 페이지'
  $('pageMeta').textContent = `ID: ${channelId}`
  show('channelInfo', true)
}

// ── Clip download button ──────────────────────────────────────────────
$('btnDownloadClip').addEventListener('click', async () => {
  if (!currentClipInfo || !currentPageInfo?.clipId) return
  const quality = $('clipQuality').value
  $('btnDownloadClip').disabled = true
  $('btnDownloadClip').textContent = '⏳ 다운로드 중...'
  showStatus('다운로드를 시작합니다...', 'info')

  const result = await bg({ action: 'downloadClip', clipId: currentPageInfo.clipId, quality })

  if (result?.error) {
    showStatus(`❌ ${result.error}`, 'err')
  } else {
    showStatus(`✅ 다운로드 시작됨 (${result.height || '?'}p)`, 'ok')
  }
  $('btnDownloadClip').disabled = false
  $('btnDownloadClip').textContent = '⬇ 클립 다운로드'
})

// ── VOD download via server ───────────────────────────────────────────
$('btnDownloadVod').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab?.url
  if (!url) return
  $('btnDownloadVod').disabled = true
  $('btnDownloadVod').textContent = '⏳ 시작 중...'
  showStatus('서버에 다운로드 요청 중...', 'info')

  let soopUsername = '', soopPassword = ''
  if (isSoopUrl(url)) {
    soopUsername = $('soopUsername').value.trim()
    soopPassword = $('soopPassword').value
    await saveSoopCreds(soopUsername, soopPassword)
  }

  const r = await bg({ action: 'startVodDownload', url, soopUsername, soopPassword })
  if (r?.error) {
    showStatus(`❌ ${r.error}`, 'err')
    $('btnDownloadVod').disabled = false
    $('btnDownloadVod').textContent = '⬇ VOD 다운로드'
    return
  }
  showStatus('⏳ yt-dlp 다운로드 중...', 'info')
  startVodPoll(r.token)
})

// ── VOD copy command ──────────────────────────────────────────────────
$('btnCopyCmd').addEventListener('click', async () => {
  const cmd = $('vodCommand').textContent
  await navigator.clipboard.writeText(cmd)
  $('btnCopyCmd').textContent = '✅ 복사됨!'
  setTimeout(() => { $('btnCopyCmd').textContent = '📋 명령어 복사' }, 2000)
})

// ── Live record buttons ───────────────────────────────────────────────
$('btnRecordLive').addEventListener('click', async () => {
  const channelId = $('liveChannelId').value
  if (!channelId) return
  $('btnRecordLive').disabled = true
  $('btnRecordLive').textContent = '⏳ 시작 중...'
  showStatus('녹화를 시작합니다...', 'info')

  const r = await bg({ action: 'startLiveRecord', channelId })
  if (r?.error) {
    showStatus(`❌ ${r.error}`, 'err')
    $('btnRecordLive').disabled = false
    $('btnRecordLive').textContent = '⏺ 녹화 시작'
    return
  }

  liveRecordToken = r.token
  $('btnRecordLive').style.display = 'none'
  $('btnStopLive').style.display = 'block'
  showStatus('⏺ 녹화 중...', 'info')
  startLivePoll(r.token)
})

$('btnStopLive').addEventListener('click', async () => {
  if (!liveRecordToken) return
  $('btnStopLive').disabled = true
  $('btnStopLive').textContent = '⏳ 중지 중...'
  await bg({ action: 'stopLiveRecord', token: liveRecordToken })
  if (livePollTimer) clearInterval(livePollTimer)
  showStatus('⏹ 녹화가 중지되었습니다. 파일이 저장됩니다.', 'ok')
  $('btnStopLive').style.display = 'none'
  $('btnRecordLive').style.display = 'block'
  $('btnRecordLive').disabled = false
  $('btnRecordLive').textContent = '⏺ 녹화 시작'
  liveRecordToken = null
})

$('btnCopyLiveCmd').addEventListener('click', async () => {
  const cmd = $('liveCommand').textContent
  await navigator.clipboard.writeText(cmd)
  $('btnCopyLiveCmd').textContent = '✅ 복사됨!'
  setTimeout(() => { $('btnCopyLiveCmd').textContent = '📋 명령어 복사' }, 2000)
})

function startLivePoll(token) {
  if (livePollTimer) clearInterval(livePollTimer)
  livePollTimer = setInterval(async () => {
    const r = await bg({ action: 'getVodStatus', token })
    if (!r || r.error) return
    if (r.status === 'done' && r.fileToken) {
      clearInterval(livePollTimer)
      showStatus('✅ 녹화 완료! 저장 중...', 'ok')
      const a = document.createElement('a')
      a.href = `http://localhost:5555/file/${r.fileToken}`
      a.click()
      $('btnStopLive').style.display = 'none'
      $('btnRecordLive').style.display = 'block'
      $('btnRecordLive').disabled = false
      $('btnRecordLive').textContent = '⏺ 녹화 시작'
    } else if (r.status === 'error') {
      clearInterval(livePollTimer)
      showStatus(`❌ ${r.error || '녹화 실패'}`, 'err')
      $('btnStopLive').style.display = 'none'
      $('btnRecordLive').style.display = 'block'
      $('btnRecordLive').disabled = false
      $('btnRecordLive').textContent = '⏺ 녹화 시작'
    }
  }, 3000)
}

// ── Go to clips tab ───────────────────────────────────────────────────
$('btnGoToClips').addEventListener('click', () => {
  document.querySelector('[data-tab="clips"]').click()
  if (currentPageInfo?.channelId) loadChannelClips(currentPageInfo.channelId, true)
})

// ── Tab 2: Channel Clips ──────────────────────────────────────────────
$('btnLoadClips').addEventListener('click', async () => {
  const inputId = $('channelIdInput').value.trim()
  if (!inputId) { alert('채널 ID 또는 URL을 입력해주세요.'); return }

  // Accept full URL or bare channelId
  const urlMatch = inputId.match(/chzzk\.naver\.com\/([0-9a-fA-F]{20,})/)
  const channelId = (urlMatch ? urlMatch[1] : inputId).toLowerCase()

  await loadChannelClips(channelId, true)
})

async function loadChannelClips(channelId, reset = false) {
  if (reset) {
    clipsCursor = null
    totalLoaded = 0
    clipsChannelId = channelId
    $('clipList').innerHTML = ''
    show('clipsEmpty', false)
    show('clipsContent', false)
  }

  show('clipsLoading', true)
  $('btnLoadMore').disabled = true

  const result = await bg({ action: 'getChannelClips', channelId, cursor: clipsCursor, size: 20 })

  show('clipsLoading', false)

  if (result?.error) {
    show('clipsContent', false)
    show('clipsEmpty', true)
    $('clipsEmpty').innerHTML = `<p style="color:#ef4444">❌ ${result.error}</p><p style="margin-top:6px;font-size:11px;color:#475569">채널 URL을 다시 확인해주세요.<br>예: https://chzzk.naver.com/8421eba...</p>`
    return
  }

  const clips = result.clips || []
  clipsHasNext = result.hasNext
  clipsCursor = result.nextCursor   // cursor for next page
  totalLoaded += clips.length

  if (reset && clips.length === 0) {
    show('clipsEmpty', true)
    $('clipsEmpty').innerHTML = `<p>클립이 없습니다.</p>`
    return
  }

  show('clipsContent', true)
  $('clipsCount').textContent = `${totalLoaded}개 로드됨`

  clips.forEach(clip => {
    const item = buildClipItem(clip)
    $('clipList').appendChild(item)
  })

  if (clipsHasNext) {
    $('btnLoadMore').style.display = 'block'
    $('btnLoadMore').disabled = false
  } else {
    $('btnLoadMore').style.display = 'none'
  }
}

function buildClipItem(clip) {
  const clipId = clip.clipUID || clip.clipUid || clip.clipId || clip.id
  const title = clip.clipTitle || clip.title || '제목 없음'
  const thumb = clip.thumbnailImageUrl || clip.thumbnailUrl || ''
  const creator = clip.channel?.channelName || clip.channelName || clip.creatorName || ''
  const dur = clip.duration ? fmtDur(clip.duration) : ''

  const item = document.createElement('div')
  item.className = 'clip-item'
  item.innerHTML = `
    <img class="clip-thumb" src="${thumb}" onerror="this.style.background='#1a1f2e'" />
    <div class="clip-info">
      <div class="clip-name">${escHtml(title)}</div>
      <div class="clip-creator">${escHtml(creator)}${dur ? '  •  ' + dur : ''}</div>
      <button class="clip-dl-btn" data-clip-id="${clipId}">⬇ 다운로드</button>
    </div>
  `

  item.querySelector('.clip-dl-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget
    if (!clipId) { btn.textContent = '❌ ID 없음'; return }
    btn.disabled = true
    btn.textContent = '⏳...'
    const r = await bg({ action: 'downloadClip', clipId, quality: 'best' })
    if (r?.error) {
      btn.textContent = '❌ 실패'
      btn.title = r.error
      setTimeout(() => { btn.disabled = false; btn.textContent = '⬇ 다운로드' }, 3000)
    } else {
      btn.textContent = '✅ 시작됨'
      setTimeout(() => { btn.disabled = false; btn.textContent = '⬇ 다운로드' }, 3000)
    }
  })

  return item
}

$('btnLoadMore').addEventListener('click', () => {
  if (clipsChannelId) loadChannelClips(clipsChannelId, false)
})

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Init ──────────────────────────────────────────────────────────────
;(async () => {
  await checkAuth()
  await loadPageInfo()

  // Auto-load clips if on channel page
  if (currentPageInfo?.type === 'channel' && currentPageInfo.channelId) {
    await loadChannelClips(currentPageInfo.channelId, true)
  }
})()
