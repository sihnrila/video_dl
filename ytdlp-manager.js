import os from 'os'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { execSync } from 'child_process'

const PLATFORM = os.platform()
let YTDLP_BIN = 'yt-dlp'

if (PLATFORM === 'win32') YTDLP_BIN = 'yt-dlp.exe'
else if (PLATFORM === 'darwin') YTDLP_BIN = 'yt-dlp_macos'

const GITHUB_RELEASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_BIN}`

export async function ensureYtDlp(userDataPath) {
    const binPath = path.join(userDataPath, PLATFORM === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
    
    if (fs.existsSync(binPath)) {
        return binPath
    }

    console.log(`yt-dlp not found at ${binPath}, downloading from ${GITHUB_RELEASE_URL}...`)
    
    try {
        const response = await axios({
            url: GITHUB_RELEASE_URL,
            method: 'GET',
            responseType: 'stream'
        })

        const writer = fs.createWriteStream(binPath)
        response.data.pipe(writer)

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve)
            writer.on('error', reject)
        })

        if (PLATFORM !== 'win32') {
            fs.chmodSync(binPath, '755')
        }

        console.log('yt-dlp downloaded successfully.')
        return binPath
    } catch (err) {
        console.error('Failed to download yt-dlp:', err.message)
        throw err
    }
}
