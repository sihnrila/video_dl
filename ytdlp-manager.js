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

    if (fs.existsSync(binPath)) {
        const version = await run(binPath, ['--version'], 30000)
        if (version.ok) {
            // 사이트(치지직/숲) 변경에 대응하려면 yt-dlp가 항상 최신이어야 한다.
            // 셀프 업데이트 실패(네트워크 등)는 치명적이지 않으므로 기존 바이너리를 그대로 쓴다.
            console.log(`yt-dlp ${version.stdout} found, checking for updates...`)
            const update = await run(binPath, ['-U'])
            if (update.ok) {
                const lastLine = update.stdout.split('\n').pop()
                console.log(`yt-dlp update: ${lastLine}`)
            } else {
                console.error('yt-dlp self-update failed (keeping current version):', update.stderr || update.err?.message)
            }
            return binPath
        }

        // 실행조차 안 되는 바이너리(다운로드 중단 등으로 손상)는 지우고 새로 받는다
        console.error('Existing yt-dlp binary is broken, re-downloading...')
        try { fs.unlinkSync(binPath) } catch {}
    }

    try {
        return await downloadYtDlp(binPath)
    } catch (err) {
        console.error('Failed to download yt-dlp:', err.message)
        throw err
    }
}
