import os from 'os'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { execFile } from 'child_process'

const PLATFORM = os.platform()
let YTDLP_BIN = 'yt-dlp'

if (PLATFORM === 'win32') YTDLP_BIN = 'yt-dlp.exe'
else if (PLATFORM === 'darwin') YTDLP_BIN = 'yt-dlp_macos'

const GITHUB_RELEASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_BIN}`

function run(binPath, args, timeout = 120000) {
    return new Promise(resolve => {
        try {
            execFile(binPath, args, { timeout }, (err, stdout, stderr) => {
                resolve({ ok: !err, stdout: (stdout || '').trim(), stderr: (stderr || '').trim(), err })
            })
        } catch (err) {
            // 손상된 바이너리는 ENOEXEC 등으로 spawn 자체가 동기로 throw할 수 있다
            resolve({ ok: false, stdout: '', stderr: '', err })
        }
    })
}

async function downloadYtDlp(binPath) {
    console.log(`Downloading yt-dlp from ${GITHUB_RELEASE_URL}...`)

    const tmpPath = `${binPath}.download`
    const response = await axios({
        url: GITHUB_RELEASE_URL,
        method: 'GET',
        responseType: 'stream'
    })

    const writer = fs.createWriteStream(tmpPath)
    response.data.pipe(writer)

    await new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
        response.data.on('error', reject)
    })

    if (PLATFORM !== 'win32') {
        fs.chmodSync(tmpPath, '755')
    }
    fs.renameSync(tmpPath, binPath)

    console.log('yt-dlp downloaded successfully.')
    return binPath
}

export async function ensureYtDlp(userDataPath) {
    const binPath = path.join(userDataPath, PLATFORM === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')

    // 바이너리가 이미 있으면 즉시 그 경로를 쓰고(=앱 창이 바로 뜸),
    // 최신화(-U)만 백그라운드로 처리해 시작을 막지 않는다.
    // 주의: 여기서 바이너리를 지우고 다시 받으면 안 된다 —
    //       진행 중인 다운로드/녹화가 쓰는 바이너리를 없애 실패시킬 수 있다.
    //       (손상 바이너리는 다운로드 시 .download 임시파일→원자적 rename으로 이미 예방됨)
    if (fs.existsSync(binPath)) {
        run(binPath, ['-U']).then(update => {
            if (update.ok) console.log(`yt-dlp update: ${update.stdout.split('\n').pop()}`)
            else console.error('yt-dlp self-update failed (keeping current version):', update.stderr || update.err?.message)
        })
        return binPath
    }

    // 최초 실행 등 바이너리가 아예 없을 때만 다운로드를 기다린다
    try {
        return await downloadYtDlp(binPath)
    } catch (err) {
        console.error('Failed to download yt-dlp:', err.message)
        throw err
    }
}
