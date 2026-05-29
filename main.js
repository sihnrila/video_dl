import { app, BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { startServer } from './server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        title: 'CHZZK DL',
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

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
