import { app, BrowserWindow, dialog } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { startServer } from './server.js'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow

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
    })

    autoUpdater.checkForUpdates()
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

    // Start backend server
    const port = process.env.PORT || 5555
    const userDataPath = app.getPath('userData')
    
    try {
        await startServer({ port, userDataPath })
        mainWindow.loadURL(`http://localhost:${port}`)
    } catch (err) {
        console.error('Failed to start server:', err)
    }
}

app.whenReady().then(() => {
    createWindow()

    if (app.isPackaged) setupAutoUpdater()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
