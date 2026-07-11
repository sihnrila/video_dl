import { app, BrowserWindow, dialog, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { startServer } from './server.js'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow

const REPO = 'sihnrila/video_dl'
let updateNoticeShown = false

const parseVer = v => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
const isNewer = (a, b) => {
    const [x, y] = [parseVer(a), parseVer(b)]
    for (let i = 0; i < 3; i++) {
        if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
    }
    return false
}

// 서명 없는 맥 빌드는 electron-updater가 자동 설치를 못 하므로(서명 검증 필수)
// 직접 GitHub 릴리스 버전을 확인해서 다운로드 페이지로 안내한다
async function notifyManualUpdate() {
    if (updateNoticeShown) return
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
        if (!res.ok) return
        const latest = (await res.json()).tag_name
        if (!latest || !isNewer(latest, app.getVersion())) return
        updateNoticeShown = true
        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '새 버전 안내',
            message: `새 버전(${latest})이 나왔습니다.\n다운로드 페이지에서 받아 설치해주세요.`,
            buttons: ['다운로드 페이지 열기', '나중에'],
            defaultId: 0
        })
        if (response === 0) shell.openExternal(`https://github.com/${REPO}/releases/latest`)
    } catch (err) {
        console.error('Manual update check failed:', err)
    }
}

function setupAutoUpdater() {
    autoUpdater.autoDownload = true

    autoUpdater.on('update-downloaded', async () => {
        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '업데이트 준비 완료',
            message: '새 버전이 다운로드되었습니다. 지금 재시작해서 설치할까요?',
            buttons: ['지금 재시작', '나중에'],
            defaultId: 0
        })
        if (response === 0) autoUpdater.quitAndInstall()
    })

    autoUpdater.on('error', err => {
        console.error('Auto-update error:', err)
        if (process.platform === 'darwin') notifyManualUpdate()
    })

    autoUpdater.checkForUpdates()
}

const serverPort = process.env.PORT || 5555
let serverPromise = null

// 서버는 앱 수명 동안 딱 한 번만 시작한다. 창을 닫았다 다시 열어도(activate)
// 서버를 다시 켜지 않아 포트 충돌(EADDRINUSE)로 인한 시작 오류가 없다.
function ensureServer() {
    if (!serverPromise) {
        serverPromise = startServer({
            port: serverPort,
            userDataPath: app.getPath('userData'),
            downloadsPath: app.getPath('downloads')
        }).catch(err => { console.error('Failed to start server:', err) })
    }
    return serverPromise
}

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        title: 'CHZZK & SOOP DL',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    })

    await ensureServer()
    mainWindow.loadURL(`http://localhost:${serverPort}`)
}

// 두 번째 실행을 막아 서버가 중복으로 뜨지 않게 한다 (이미 열린 창을 앞으로)
if (!app.requestSingleInstanceLock()) {
    app.quit()
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }
    })

    app.whenReady().then(() => {
        createWindow()

        if (app.isPackaged) setupAutoUpdater()

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow()
        })
    })
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
