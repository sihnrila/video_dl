import express from 'express'
import { spawn } from 'child_process'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

app.post('/download', (req, res) => {
  const { url, quality = 'best', browser = 'chrome' } = req.body

  if (!url?.includes('chzzk.naver.com')) {
    return res.status(400).json({ error: '치지직 URL만 가능합니다.' })
  }

  const outputDir = path.join(os.homedir(), 'Downloads')
  const args = []

  if (browser !== 'none') {
    args.push('--cookies-from-browser', browser)
  }
  
  args.push('-f', quality === 'best' ? 'best' : quality)
  args.push('-o', `${outputDir}/%(title)s.%(ext)s`)
  args.push('--newline') // Ensure progress is sent line by line
  args.push(url)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  console.log(`Starting download: ${url}`)
  
  const proc = spawn('yt-dlp', args)

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n')
    lines.forEach(line => {
      if (line.trim()) {
        res.write(`data: ${JSON.stringify({ type: 'stdout', message: line.trim() })}\n\n`)
      }
    })
  })

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n')
    lines.forEach(line => {
      if (line.trim()) {
        res.write(`data: ${JSON.stringify({ type: 'stderr', message: line.trim() })}\n\n`)
      }
    })
  })

  proc.on('close', (code) => {
    console.log(`Process exited with code ${code}`)
    res.write(`data: ${JSON.stringify({ type: 'status', message: code === 0 ? 'DONE' : 'ERROR', code })}\n\n`)
    res.end()
  })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`\n🚀 Server is running at http://localhost:${PORT}`)
  console.log(`📂 Downloads will be saved to: ${path.join(os.homedir(), 'Downloads')}\n`)
})
