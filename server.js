import express from 'express'
import { spawn } from 'child_process'
import path from 'path'
import os from 'os'
import fs from 'fs'
import https from 'https'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import ffmpegStatic from 'ffmpeg-static'
import { ensureYtDlp } from './ytdlp-manager.js'

let ytDlpPath = 'yt-dlp'
// 패키징된 앱에서 ffmpeg 바이너리는 asar 밖(app.asar.unpacked)에 풀리는데,
// ffmpeg-static이 주는 경로는 asar 안을 가리켜 외부 프로세스(yt-dlp)가 실행할 수 없다
let ffmpegPath = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : ffmpegStatic

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

// Temp file registry: token → { path, filename, createdAt }
const pendingFiles = new Map()

// VOD job registry: token → { status, log[], progress, error, path, filename, startedAt }
const vodJobs = new Map()
setInterval(() => {
  const cutoff = Date.now() - 7200000
  for (const [token, job] of vodJobs) {
    if (job.startedAt < cutoff) {
      if (job.path) fs.unlink(job.path, () => {})
      vodJobs.delete(token)
    }
  }
}, 600000)
setInterval(() => {
  const cutoff = Date.now() - 3600000
  for (const [token, info] of pendingFiles) {
    if (info.createdAt < cutoff) {
      fs.unlink(info.path, () => {})
      pendingFiles.delete(token)
    }
  }
}, 600000)

// 실패/중단된 다운로드의 임시파일(.part 등)은 pendingFiles에 등록되지 않아
// 위 청소 로직이 못 지운다 → 작업 실패 시 토큰 프리픽스로 직접 정리
function cleanupTempFiles(prefix) {
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (f.startsWith(prefix)) fs.unlink(path.join(os.tmpdir(), f), () => {})
    }
  } catch {}
}

// Serve a downloaded file to the browser
app.get('/file/:token', (req, res) => {
  const info = pendingFiles.get(req.params.token)
  if (!info) return res.status(404).send('파일을 찾을 수 없습니다. 다시 다운로드해주세요.')
  pendingFiles.delete(req.params.token)
  res.download(info.path, info.filename, () => fs.unlink(info.path, () => {}))
})

function cleanCookieValue(val) {
  if (!val) return ''
  val = val.trim()
  return val.includes('=') ? val.split('=').slice(1).join('=').trim() : val
}

function fetchApi(hostname, apiPath, nidAut, nidSes) {
  return new Promise((resolve, reject) => {
    const cookieParts = []
    const aut = cleanCookieValue(nidAut)
    const ses = cleanCookieValue(nidSes)
    if (aut) cookieParts.push(`NID_AUT=${aut}`)
    if (ses) cookieParts.push(`NID_SES=${ses}`)

    https.get({
      hostname,
      path: apiPath,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://chzzk.naver.com/',
        'Accept': 'application/json',
        ...(cookieParts.length ? { 'Cookie': cookieParts.join('; ') } : {})
      }
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        console.log(`[${hostname}${apiPath}] → ${res.statusCode}: ${data.slice(0, 200)}`)
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }) }
        catch (e) { reject(new Error(`JSON 파싱 오류: ${data.slice(0, 100)}`)) }
      })
    }).on('error', reject)
  })
}

// Step 1: clip detail → videoId
// Step 2: videohub → direct MP4 URLs sorted by resolution (highest first)
async function resolveClipUrls(clipId, nidAut, nidSes) {
  const { status, json } = await fetchApi(
    'api.chzzk.naver.com',
    `/service/v1/clips/${clipId}/detail?optionalProperties=OWNER_CHANNEL`,
    nidAut, nidSes
  )

  if (status === 401) throw new Error('인증 실패 (401): NID_AUT와 NID_SES 값을 확인해주세요.\nChrome → F12 → Application → Cookies → chzzk.naver.com')
  if (status === 404) throw new Error('클립을 찾을 수 없습니다 (404). URL을 다시 확인해주세요.')
  if (status !== 200) throw new Error(`클립 API 오류 (${status}): ${json?.message || ''}`)

  const content = json?.content
  if (!content) throw new Error('API 응답에 content가 없습니다.')

  const videoId = content.videoId
  const title = content.clipTitle
  if (!videoId) throw new Error(`videoId를 찾지 못했습니다. 응답 키: ${Object.keys(content).join(', ')}`)

  const { status: vs, json: vj } = await fetchApi(
    'api-videohub.naver.com',
    `/shortformhub/feeds/v3/card?serviceType=CHZZK&seedMediaId=${videoId}&mediaType=VOD`,
    nidAut, nidSes
  )

  if (vs !== 200) throw new Error(`Videohub API 오류 (${vs})`)
  if (vj?.card?.content?.error) throw new Error(`Videohub 오류: ${JSON.stringify(vj.card.content.error)}`)

  const list = vj?.card?.content?.vod?.playback?.videos?.list
  if (!list?.length) throw new Error('스트림 URL을 찾지 못했습니다.')

  const sorted = [...list]
    .filter(v => v.source)
    .sort((a, b) => (b.encodingOption?.height || 0) - (a.encodingOption?.height || 0))

  return { title, streams: sorted }
}

function selectStream(streams, quality) {
  if (quality === 'best') return streams[0]
  const target = parseInt(quality, 10)
  return streams.find(s => s.encodingOption?.height === target)
    || streams.find(s => (s.encodingOption?.height || 0) <= target)
    || streams[0]
}

// Download a URL to a local file, calling onProgress(received, total) each chunk
function downloadToFile(url, filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const doReq = (currentUrl, hops = 0) => {
      if (hops > 5) return reject(new Error('Too many redirects'))
      https.get(currentUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://chzzk.naver.com/' }
      }, res => {
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          res.resume()
          const loc = res.headers.location
          return doReq(loc.startsWith('http') ? loc : new URL(loc, currentUrl).href, hops + 1)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode}`))
        }

        const total = parseInt(res.headers['content-length']) || 0
        let received = 0
        const file = fs.createWriteStream(filePath)

        res.on('data', chunk => { received += chunk.length; onProgress?.(received, total) })
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
        file.on('error', err => { fs.unlink(filePath, () => {}); reject(err) })
      }).on('error', reject)
    }
    doReq(url)
  })
}

const fmtBytes = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${(n / 1024).toFixed(0)}KB`

// Extension VOD: start background download, return token immediately
function isSoopUrl(url) {
  return /soop\.com|sooplive\.com|sooplive\.co\.kr/.test(url)
}

app.post('/api/start-vod', async (req, res) => {
  const { url, quality = 'best', nidAut = '', nidSes = '', soopUsername = '', soopPassword = '' } = req.body
  const isSoop = isSoopUrl(url)
  if (!url?.match(/chzzk\.naver\.com\/video\/\w+/) && !isSoop)
    return res.status(400).json({ error: '치지직 또는 숲 VOD URL만 가능합니다.' })

  const token = crypto.randomBytes(16).toString('hex')
  const job = { url, status: 'running', log: [], progress: 0, error: null, path: null, filename: null, startedAt: Date.now() }
  vodJobs.set(token, job)

  res.json({ token })

  // Run yt-dlp in background
  ;(async () => {
    const tmpTemplate = path.join(os.tmpdir(), `chzzk_${token}.%(ext)s`)
    const args = []
    const aut = cleanCookieValue(nidAut)
    const ses = cleanCookieValue(nidSes)
    if (isSoopUrl(url)) {
      if (soopUsername && soopPassword) args.push('--username', soopUsername, '--password', soopPassword)
      args.push('--add-header', 'Referer:https://www.soop.com/')
    } else {
      if (aut && ses) args.push('--add-header', `Cookie:NID_AUT=${aut}; NID_SES=${ses}`)
      args.push('--add-header', 'Referer:https://chzzk.naver.com/')
    }
    const maxH = parseInt(quality, 10)
    const fmt = !maxH
      ? 'bv+ba/b'
      : `bestvideo[height<=${maxH}]+bestaudio/best[height<=${maxH}]`
    args.push('-f', fmt, '--merge-output-format', 'mp4')
    args.push('-o', tmpTemplate)
    args.push('--no-check-certificates', '--newline')
    args.push(url)

    args.push('--ffmpeg-location', ffmpegPath)
    const proc = spawn(ytDlpPath, args)
    let actualPath = null

    proc.stdout.on('data', data => {
      const text = data.toString()
      const dest = text.match(/\[download\] Destination: (.+)/)
      if (dest) actualPath = dest[1].trim()
      const merge = text.match(/Merging formats into "(.+)"/)
      if (merge) actualPath = merge[1].trim()
      const pctM = text.match(/(\d+\.?\d*)%/)
      if (pctM) job.progress = parseFloat(pctM[1])
      text.split('\n').forEach(l => { if (l.trim()) job.log.push(l.trim()) })
    })
    proc.stderr.on('data', data => {
      data.toString().split('\n').forEach(l => { if (l.trim()) job.log.push(`[err] ${l.trim()}`) })
    })

    proc.on('close', code => {
      if (code === 0) {
        if (!actualPath) {
          const found = fs.readdirSync(os.tmpdir()).find(f => f.startsWith(`chzzk_${token}`))
          if (found) actualPath = path.join(os.tmpdir(), found)
        }
        if (actualPath && fs.existsSync(actualPath)) {
          const ext = path.extname(actualPath).slice(1) || 'mp4'
          job.path = actualPath
          job.filename = `download.${ext}`
          pendingFiles.set(token, { path: actualPath, filename: job.filename, createdAt: Date.now() })
          job.progress = 100
          job.status = 'done'
        } else {
          job.status = 'error'
          job.error = '다운로드 파일을 찾지 못했습니다.'
        }
      } else {
        job.status = 'error'
        job.error = `yt-dlp 종료 코드: ${code}`
        cleanupTempFiles(`chzzk_${token}`)
      }
    })
  })()
})

// Extension VOD: poll status
app.get('/api/vod-status/:token', (req, res) => {
  const job = vodJobs.get(req.params.token)
  if (!job) return res.status(404).json({ error: '작업을 찾을 수 없습니다.' })
  res.json({
    status: job.status,
    progress: job.progress,
    log: job.log.slice(-5),
    fileToken: job.status === 'done' ? req.params.token : null,
    error: job.error
  })
})

// Active VOD jobs list for React UI
app.get('/api/active-jobs', (req, res) => {
  const list = []
  for (const [token, job] of vodJobs.entries()) {
    if (Date.now() - job.startedAt < 2 * 60 * 60 * 1000) {
      list.push({
        token,
        url: job.url || '',
        status: job.status,
        progress: job.progress,
        error: job.error,
        log: job.log.slice(-1)[0] || '',
        startedAt: job.startedAt
      })
    }
  }
  list.sort((a, b) => b.startedAt - a.startedAt)
  res.json(list)
})

app.post('/download', async (req, res) => {
  const { url, quality = 'best', nidAut = '', nidSes = '', soopUsername = '', soopPassword = '' } = req.body
  const isChzzk = url?.includes('chzzk.naver.com')
  const isSoop = isSoopUrl(url || '')
  if (!isChzzk && !isSoop) return res.status(400).json({ error: '치지직 또는 숲 URL만 가능합니다.' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`)

  try {
    const clipMatch = url.match(/chzzk\.naver\.com\/clips\/([A-Za-z0-9_-]+)/)

    if (isSoop) {
      // ====== SOOP ======
      send('log', '⬇️ 숲(SOOP) 다운로드 시작...')

      const token = crypto.randomBytes(16).toString('hex')
      const tmpTemplate = path.join(os.tmpdir(), `soop_${token}.%(ext)s`)
      const args = []

      if (soopUsername && soopPassword) args.push('--username', soopUsername, '--password', soopPassword)
      args.push('--add-header', 'Referer:https://www.soop.com/')

      const fmt = quality === 'best'
        ? 'bv+ba/b'
        : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`

      args.push('-f', fmt, '--merge-output-format', 'mp4')
      args.push('-o', tmpTemplate)
      args.push('--no-check-certificates', '--newline')
      args.push(url)
      args.push('--ffmpeg-location', ffmpegPath)

      const proc = spawn(ytDlpPath, args)
      let actualPath = null

      proc.stdout.on('data', data => {
        const text = data.toString()
        const dest = text.match(/\[download\] Destination: (.+)/)
        if (dest) actualPath = dest[1].trim()
        const merge = text.match(/Merging formats into "(.+)"/)
        if (merge) actualPath = merge[1].trim()
        const pctM = text.match(/(\d+\.?\d*)%/)
        if (pctM) send('progress', parseFloat(pctM[1]))
        text.split('\n').forEach(l => { if (l.trim()) send('log', l.trim()) })
      })
      proc.stderr.on('data', data => {
        data.toString().split('\n').forEach(l => { if (l.trim()) send('err', l.trim()) })
      })
      proc.on('close', code => {
        if (code === 0) {
          if (!actualPath) {
            const found = fs.readdirSync(os.tmpdir()).find(f => f.startsWith(`soop_${token}`))
            if (found) actualPath = path.join(os.tmpdir(), found)
          }
          if (actualPath && fs.existsSync(actualPath)) {
            const ext = path.extname(actualPath).slice(1) || 'mp4'
            pendingFiles.set(token, { path: actualPath, filename: `soop_download.${ext}`, createdAt: Date.now() })
            send('progress', 100)
            send('file_ready', token)
            send('done', 'OK')
          } else {
            send('err', '❌ 다운로드 파일을 찾지 못했습니다.')
            send('done', 'ERROR')
          }
        } else {
          cleanupTempFiles(`soop_${token}`)
          send('done', 'ERROR')
        }
        res.end()
      })
      return

    } else if (clipMatch) {
      // ====== CLIP ======
      const clipId = clipMatch[1]
      if (!nidAut || !nidSes) throw new Error('클립 다운로드에는 NID_AUT와 NID_SES 쿠키가 필요합니다.')

      send('log', `🔍 클립 정보 조회 중 (ID: ${clipId})`)
      const { title, streams } = await resolveClipUrls(clipId, nidAut, nidSes)
      const selected = selectStream(streams, quality)

      send('log', `📌 제목: ${title}`)
      send('log', `📊 사용 가능 화질: ${streams.map(s => `${s.encodingOption?.height || '?'}p`).join(', ')}`)
      send('log', `⬇️ ${selected.encodingOption?.height || '?'}p 다운로드 중...`)

      const token = crypto.randomBytes(16).toString('hex')
      const tmpPath = path.join(os.tmpdir(), `chzzk_${token}.mp4`)
      const safeTitle = (title || 'clip').replace(/[\\/:*?"<>|\n]/g, '').trim() || 'clip'

      let lastPct = -1
      await downloadToFile(selected.source, tmpPath, (received, total) => {
        if (!total) return
        const pct = Math.floor(received / total * 100)
        if (pct > lastPct && pct % 5 === 0) {
          lastPct = pct
          send('progress', pct)
          send('log', `[download] ${pct}% (${fmtBytes(received)} / ${fmtBytes(total)})`)
        }
      })

      pendingFiles.set(token, { path: tmpPath, filename: `${safeTitle}.mp4`, createdAt: Date.now() })
      send('progress', 100)
      send('file_ready', token)
      send('done', 'OK')
      res.end()

    } else if (url.match(/chzzk\.naver\.com\/video\/\w+/)) {
      // ====== VOD ======
      send('log', '⬇️ VOD 다운로드 시작...')

      const token = crypto.randomBytes(16).toString('hex')
      const tmpTemplate = path.join(os.tmpdir(), `chzzk_${token}.%(ext)s`)

      const args = []
      const aut = cleanCookieValue(nidAut)
      const ses = cleanCookieValue(nidSes)
      if (aut && ses) args.push('--add-header', `Cookie:NID_AUT=${aut}; NID_SES=${ses}`)

      const fmt = quality === 'best'
        ? 'bv+ba/b'
        : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`

      args.push('-f', fmt, '--merge-output-format', 'mp4')
      args.push('-o', tmpTemplate)
      args.push('--no-check-certificates', '--add-header', 'Referer:https://chzzk.naver.com/', '--newline')
      args.push(url)

      args.push('--ffmpeg-location', ffmpegPath)
      const proc = spawn(ytDlpPath, args)
      let actualPath = null

      proc.stdout.on('data', data => {
        const text = data.toString()
        const dest = text.match(/\[download\] Destination: (.+)/)
        if (dest) actualPath = dest[1].trim()
        const merge = text.match(/Merging formats into "(.+)"/)
        if (merge) actualPath = merge[1].trim()
        const pctM = text.match(/(\d+\.?\d*)%/)
        if (pctM) send('progress', parseFloat(pctM[1]))
        text.split('\n').forEach(l => { if (l.trim()) send('log', l.trim()) })
      })
      proc.stderr.on('data', data => {
        data.toString().split('\n').forEach(l => { if (l.trim()) send('err', l.trim()) })
      })

      proc.on('close', code => {
        if (code === 0) {
          if (!actualPath) {
            const found = fs.readdirSync(os.tmpdir()).find(f => f.startsWith(`chzzk_${token}`))
            if (found) actualPath = path.join(os.tmpdir(), found)
          }
          if (actualPath && fs.existsSync(actualPath)) {
            const ext = path.extname(actualPath).slice(1) || 'mp4'
            pendingFiles.set(token, { path: actualPath, filename: `download.${ext}`, createdAt: Date.now() })
            send('progress', 100)
            send('file_ready', token)
            send('done', 'OK')
          } else {
            send('err', '❌ 다운로드 파일을 찾지 못했습니다.')
            send('done', 'ERROR')
          }
        } else {
          cleanupTempFiles(`chzzk_${token}`)
          send('done', 'ERROR')
        }
        res.end()
      })

      return

    } else {
      throw new Error('지원하지 않는 URL입니다. /video/ 또는 /clips/ URL을 입력해주세요.')
    }

  } catch (err) {
    console.error('Error:', err.message)
    send('err', `❌ ${err.message}`)
    send('done', 'ERROR')
    res.end()
  }
})

app.get('/api/channel-clips', async (req, res) => {
  let { channelId = '', cursor, size = '20', nidAut = '', nidSes = '' } = req.query

  const urlMatch = channelId.match(/chzzk\.naver\.com\/([0-9a-fA-F]{20,})/i)
  if (urlMatch) channelId = urlMatch[1]

  if (!channelId.match(/^[0-9a-fA-F]{20,}$/i))
    return res.status(400).json({ error: '올바른 채널 URL을 입력해주세요. (예: https://chzzk.naver.com/8421eba...)' })

  try {
    let apiPath = `/service/v1/channels/${channelId}/clips?size=${size}`
    if (cursor) apiPath += `&next=${encodeURIComponent(cursor)}`

    const { status, json } = await fetchApi('api.chzzk.naver.com', apiPath, nidAut, nidSes)

    if (status === 401) return res.status(401).json({ error: '인증 실패. NID_AUT와 NID_SES를 다시 확인해주세요.' })
    if (status !== 200) return res.status(status).json({ error: `API 오류 (${status})` })

    const content = json.content || {}
    res.json({
      clips: content.data || [],
      nextCursor: content.page?.next?.clipUID || null,
      hasNext: !!content.page?.next?.clipUID
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// SOOP channel VOD listing: stationId -> { entries, fetchedAt }
const soopVodCache = new Map()
const SOOP_VOD_CACHE_TTL = 5 * 60 * 1000

function runYtDlpJson(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlpPath, args)
    let out = ''
    let err = ''
    proc.stdout.on('data', d => { out += d.toString() })
    proc.stderr.on('data', d => { err += d.toString() })
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err.trim().split('\n').filter(Boolean).pop() || `yt-dlp 종료 코드: ${code}`))
      try { resolve(JSON.parse(out)) } catch { reject(new Error('yt-dlp 응답을 해석하지 못했습니다.')) }
    })
  })
}

app.get('/api/soop-vods', async (req, res) => {
  let { channelId = '', cursor = '0', size = '20' } = req.query
  channelId = channelId.trim()

  const stationMatch = channelId.match(/(?:soop\.com|sooplive\.com|sooplive\.co\.kr)\/(?:station\/)?([A-Za-z0-9_]+)/i)
  const stationId = stationMatch ? stationMatch[1] : channelId

  if (!stationId.match(/^[A-Za-z0-9_]+$/))
    return res.status(400).json({ error: '올바른 숲 채널 URL 또는 BJ ID를 입력해주세요. (예: https://www.sooplive.com/station/janjanoo)' })

  try {
    let cached = soopVodCache.get(stationId)
    if (!cached || Date.now() - cached.fetchedAt > SOOP_VOD_CACHE_TTL) {
      const vodUrl = `https://www.sooplive.com/station/${stationId}/vod`
      const data = await runYtDlpJson(['--flat-playlist', '-J', '--no-warnings', vodUrl])
      const entries = (data.entries || []).map(e => ({ id: String(e.id), title: e.title, url: e.url }))
      cached = { entries, fetchedAt: Date.now() }
      soopVodCache.set(stationId, cached)
    }

    const offset = parseInt(cursor, 10) || 0
    const sz = parseInt(size, 10) || 20
    const page = cached.entries.slice(offset, offset + sz)
    const nextOffset = offset + sz

    res.json({
      vods: page,
      nextCursor: String(nextOffset),
      hasNext: nextOffset < cached.entries.length
    })
  } catch (err) {
    res.status(500).json({ error: err.message || '채널 VOD 목록을 불러오지 못했습니다. BJ ID를 확인해주세요.' })
  }
})

// PIN store: 6자리 숫자 → { nidAut, nidSes, expiresAt }
const pinStore = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [pin, data] of pinStore) {
    if (data.expiresAt < now) pinStore.delete(pin)
  }
}, 300000)

// Live recording jobs (token → { proc, status, log[], path, startedAt })
const liveJobs = new Map()

app.post('/api/start-live', async (req, res) => {
  const { channelId, nidAut = '', nidSes = '' } = req.body
  if (!channelId) return res.status(400).json({ error: '채널 ID가 필요합니다.' })

  const token = crypto.randomBytes(16).toString('hex')
  const job = { status: 'running', log: [], progress: 0, error: null, path: null, filename: null, startedAt: Date.now(), proc: null }
  vodJobs.set(token, job)
  liveJobs.set(token, job)

  res.json({ token })

  ;(async () => {
    const url = `https://chzzk.naver.com/live/${channelId}`
    const tmpTemplate = path.join(os.tmpdir(), `chzzk_live_${token}.%(ext)s`)
    const args = []
    const aut = cleanCookieValue(nidAut)
    const ses = cleanCookieValue(nidSes)
    if (aut && ses) args.push('--add-header', `Cookie:NID_AUT=${aut}; NID_SES=${ses}`)
    args.push('-f', 'bv+ba/b', '--merge-output-format', 'mp4')
    args.push('-o', tmpTemplate)
    args.push('--no-check-certificates', '--add-header', 'Referer:https://chzzk.naver.com/', '--newline')
    args.push(url)

    args.push('--ffmpeg-location', ffmpegPath)
    // 별도 프로세스 그룹으로 띄워야 중지 시 자식 ffmpeg까지 함께 종료할 수 있다
    const proc = spawn(ytDlpPath, args, { detached: process.platform !== 'win32' })
    job.proc = proc
    let actualPath = null

    proc.stdout.on('data', data => {
      const text = data.toString()
      const dest = text.match(/\[download\] Destination: (.+)/)
      if (dest) actualPath = dest[1].trim()
      const merge = text.match(/Merging formats into "(.+)"/)
      if (merge) actualPath = merge[1].trim()
      text.split('\n').forEach(l => { if (l.trim()) job.log.push(l.trim()) })
    })
    proc.stderr.on('data', data => {
      data.toString().split('\n').forEach(l => { if (l.trim()) job.log.push(`[err] ${l.trim()}`) })
    })
    proc.on('close', code => {
      if (code === 0 || code === null) {
        if (!actualPath) {
          const found = fs.readdirSync(os.tmpdir()).find(f => f.startsWith(`chzzk_live_${token}`))
          if (found) actualPath = path.join(os.tmpdir(), found)
        }
        // 중간에 중지된 녹화는 .part 파일로 남으므로 최종 파일명으로 바꿔서 제공
        if (actualPath && !fs.existsSync(actualPath) && fs.existsSync(`${actualPath}.part`)) {
          actualPath = `${actualPath}.part`
        }
        if (actualPath && actualPath.endsWith('.part')) {
          const finalPath = actualPath.slice(0, -5)
          try { fs.renameSync(actualPath, finalPath); actualPath = finalPath } catch {}
        }
        if (actualPath && fs.existsSync(actualPath)) {
          const ext = path.extname(actualPath).slice(1) || 'mp4'
          job.path = actualPath
          job.filename = `live_${channelId}.${ext}`
          pendingFiles.set(token, { path: actualPath, filename: job.filename, createdAt: Date.now() })
          job.progress = 100
          job.status = 'done'
        } else {
          job.status = 'error'
          job.error = '녹화 파일을 찾지 못했습니다.'
        }
      } else {
        job.status = 'error'
        job.error = `종료 코드: ${code}`
        cleanupTempFiles(`chzzk_live_${token}`)
      }
      liveJobs.delete(token)
    })
  })()
})

app.post('/api/stop-live/:token', (req, res) => {
  const job = liveJobs.get(req.params.token)
  if (!job) return res.status(404).json({ error: '녹화 작업을 찾을 수 없습니다.' })
  if (job.proc) {
    // yt-dlp만 죽이면 자식 ffmpeg가 고아로 남아 녹화가 계속된다 →
    // 프로세스 그룹 전체에 SIGINT를 보내 ffmpeg가 파일을 마무리하고 종료되게 한다
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(job.proc.pid), '/T', '/F'])
    } else {
      try { process.kill(-job.proc.pid, 'SIGINT') } catch { job.proc.kill('SIGINT') }
    }
  }
  res.json({ ok: true })
})

app.post('/api/pin/create', (req, res) => {
  const { nidAut, nidSes } = req.body
  if (!nidAut || !nidSes) return res.status(400).json({ error: '쿠키를 먼저 입력해주세요.' })
  const pin = String(Math.floor(100000 + Math.random() * 900000))
  pinStore.set(pin, { nidAut: cleanCookieValue(nidAut), nidSes: cleanCookieValue(nidSes), expiresAt: Date.now() + 3600000 })
  res.json({ pin })
})

app.post('/api/pin/load', (req, res) => {
  const pin = String(req.body.pin || '').trim()
  const data = pinStore.get(pin)
  if (!data || data.expiresAt < Date.now()) {
    pinStore.delete(pin)
    return res.status(404).json({ error: '코드가 없거나 만료되었습니다. (유효시간 1시간)' })
  }
  pinStore.delete(pin)
  res.json({ nidAut: data.nidAut, nidSes: data.nidSes })
})

app.post('/api/check-cookie', async (req, res) => {
  const { nidAut = '', nidSes = '' } = req.body
  if (!nidAut || !nidSes) return res.status(400).json({ valid: false, message: '쿠키를 입력해주세요.' })
  try {
    const { status, json } = await fetchApi('api.chzzk.naver.com', '/service/v1/account/session', nidAut, nidSes)
    if (status === 200 && json?.content) return res.json({ valid: true, message: '쿠키가 유효합니다.' })
    if (status === 401) return res.json({ valid: false, message: '쿠키가 만료되었습니다. 다시 로그인 후 복사해주세요.' })
    return res.json({ valid: false, message: `확인 실패 (${status})` })
  } catch (err) {
    res.status(500).json({ valid: false, message: err.message })
  }
})

export async function startServer({ port = 5555, userDataPath = os.tmpdir() } = {}) {
  // 작업 정보는 메모리에만 있어서, 이전 실행이 남긴 임시파일은 전부 고아다.
  // 2시간 넘은 것만 지워 동시에 떠 있는 다른 인스턴스의 진행 중 파일은 보호한다.
  try {
    const cutoff = Date.now() - 7200000
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (/^(chzzk_|soop_)/.test(f)) {
        const p = path.join(os.tmpdir(), f)
        try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p) } catch {}
      }
    }
  } catch {}

  try {
    if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true })
    ytDlpPath = await ensureYtDlp(userDataPath)
  } catch (err) {
    console.error('Failed to prepare yt-dlp:', err)
  }
  return new Promise(resolve => {
    const server = app.listen(port, () => {
      console.log(`\n🚀 http://localhost:${port}\n`)
      resolve(server)
    })
  })
}

const scriptPath = path.resolve(process.argv[1] || '')
const currentFile = path.resolve(fileURLToPath(import.meta.url))
if (scriptPath === currentFile) {
  const defaultDir = path.join(os.homedir(), '.chzzk-dl')
  startServer({ port: process.env.PORT || 5555, userDataPath: defaultDir })
}
