const { useState, useEffect, useRef } = React;

function App() {
    const [url, setUrl] = useState('');
    const [quality, setQuality] = useState('best');
    const [browser, setBrowser] = useState('chrome');
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('Ready');
    const [logs, setLogs] = useState([]);
    const logEndRef = useRef(null);

    const scrollToBottom = () => {
        logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [logs]);

    const addLog = (type, message) => {
        setLogs(prev => [...prev, { type, message, id: Date.now() + Math.random() }]);
        
        // Parse progress if it's a progress line from yt-dlp
        if (message.includes('%')) {
            const match = message.match(/(\d+\.?\d*)%/);
            if (match) {
                setProgress(parseFloat(match[1]));
            }
        }
    };

    const handleDownload = async () => {
        if (!url) return alert('URL을 입력해주세요.');
        if (!url.includes('chzzk.naver.com')) return alert('치지직 URL만 가능합니다.');

        setDownloading(true);
        setProgress(0);
        setLogs([]);
        setStatus('Initializing...');

        try {
            const response = await fetch('/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, quality, browser })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Download failed');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n\n');

                lines.forEach(line => {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.replace('data: ', ''));
                            
                            if (data.type === 'status') {
                                setStatus(data.message);
                                if (data.message === 'DONE') {
                                    setDownloading(false);
                                    setProgress(100);
                                } else if (data.message === 'ERROR') {
                                    setDownloading(false);
                                }
                            } else {
                                addLog(data.type, data.message);
                            }
                        } catch (e) {
                            // Fallback for non-JSON data
                            const msg = line.replace('data: ', '');
                            if (msg) addLog('stdout', msg);
                        }
                    }
                });
            }
        } catch (error) {
            addLog('stderr', error.message);
            setStatus('ERROR');
            setDownloading(false);
        }
    };

    return (
        <div className="container">
            <div className="glass-card">
                <h1>CHZZK DL</h1>
                <p className="subtitle">High-quality video downloader for Chzzk</p>

                <div className="input-group">
                    <label>Video URL</label>
                    <div className="input-wrapper">
                        <span className="input-icon">🔗</span>
                        <input 
                            type="text" 
                            placeholder="https://chzzk.naver.com/video/..." 
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            disabled={downloading}
                        />
                    </div>
                </div>

                <div className="options-row">
                    <div className="input-group">
                        <label>Quality</label>
                        <select value={quality} onChange={(e) => setQuality(e.target.value)} disabled={downloading}>
                            <option value="best">Best (Source)</option>
                            <option value="1080">1080p</option>
                            <option value="720">720p</option>
                            <option value="480">480p</option>
                        </select>
                    </div>
                    <div className="input-group">
                        <label>Browser Cookies</label>
                        <select value={browser} onChange={(e) => setBrowser(e.target.value)} disabled={downloading}>
                            <option value="chrome">Chrome</option>
                            <option value="edge">Edge</option>
                            <option value="firefox">Firefox</option>
                            <option value="safari">Safari</option>
                            <option value="none">None</option>
                        </select>
                    </div>
                </div>

                <button 
                    className="download-btn" 
                    onClick={handleDownload} 
                    disabled={downloading || !url}
                >
                    {downloading ? 'Downloading...' : 'Start Download'}
                </button>

                { (downloading || logs.length > 0) && (
                    <div className="progress-container">
                        <div className="progress-info">
                            <span>{status}</span>
                            <span>{progress.toFixed(1)}%</span>
                        </div>
                        <div className="progress-bar-bg">
                            <div 
                                className="progress-bar-fill" 
                                style={{ width: `${progress}%` }}
                            ></div>
                        </div>

                        <div className="log-container">
                            {logs.map(log => (
                                <div key={log.id} className={`log-line ${log.type}`}>
                                    {log.message}
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
