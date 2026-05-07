const { useState, useEffect, useRef } = React;

function App() {
    const [url, setUrl] = useState('');
    const [quality, setQuality] = useState('best');
    const [nidAut, setNidAut] = useState('');
    const [nidSes, setNidSes] = useState('');
    const [showCookieHelp, setShowCookieHelp] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('Ready');
    const [logs, setLogs] = useState([]);
    const logEndRef = useRef(null);

    const isClip = url.includes('/clips/');

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const addLog = (type, message) => {
        setLogs(prev => [...prev, { type, message, id: Date.now() + Math.random() }]);
    };

    const handleDownload = async () => {
        if (!url) return alert('URL을 입력해주세요.');
        if (!url.includes('chzzk.naver.com')) return alert('치지직 URL만 가능합니다.');
        if (isClip && (!nidAut || !nidSes)) return alert('클립 다운로드에는 NID_AUT와 NID_SES가 필요합니다.');

        setDownloading(true);
        setProgress(0);
        setLogs([]);
        setStatus('처리 중...');

        try {
            const response = await fetch('/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, quality, nidAut, nidSes })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || '요청 실패');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop();

                for (const part of parts) {
                    if (!part.startsWith('data: ')) continue;
                    try {
                        const { type, data } = JSON.parse(part.slice(6).trim());

                        if (type === 'log') {
                            addLog('stdout', data);
                        } else if (type === 'err') {
                            addLog('stderr', data);
                        } else if (type === 'progress') {
                            setProgress(typeof data === 'number' ? data : 0);
                        } else if (type === 'file_ready') {
                            setStatus('파일 준비 완료! 저장 중...');
                            setProgress(100);
                            // Trigger browser file download without navigating away
                            const link = document.createElement('a');
                            link.href = `/file/${data}`;
                            link.click();
                        } else if (type === 'done') {
                            if (data === 'OK') {
                                setStatus('✅ 완료!');
                            } else {
                                setStatus('❌ 오류 발생');
                            }
                            setDownloading(false);
                        }
                    } catch (e) {
                        console.error('SSE parse error', e);
                    }
                }
            }
        } catch (error) {
            addLog('stderr', error.message);
            setStatus('❌ 오류');
            setDownloading(false);
        }
    };

    return (
        <div className="container">
            <div className="glass-card">
                <h1>CHZZK DL</h1>
                <p className="subtitle">치지직 고화질 영상 다운로더</p>

                <div className="input-group">
                    <label>Video URL</label>
                    <div className="input-wrapper">
                        <span className="input-icon">🔗</span>
                        <input
                            type="text"
                            placeholder="https://chzzk.naver.com/clips/... 또는 /video/..."
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            disabled={downloading}
                        />
                    </div>
                </div>

                <div className="cookie-section">
                    <div className="cookie-header">
                        <span>
                            🔐 네이버 인증 쿠키
                            {!isClip && <span className="optional"> (구독자 전용 콘텐츠에만 필요)</span>}
                            {isClip && <span className="required"> (필수)</span>}
                        </span>
                        <button className="help-btn" onClick={() => setShowCookieHelp(!showCookieHelp)}>
                            {showCookieHelp ? '닫기' : '?'}
                        </button>
                    </div>

                    {showCookieHelp && (
                        <div className="cookie-help">
                            <p>① Chrome에서 <strong>chzzk.naver.com</strong>에 로그인</p>
                            <p>② <code>F12</code> → <strong>Application</strong> → <strong>Cookies</strong> → <code>https://chzzk.naver.com</code></p>
                            <p>③ <code>NID_AUT</code>와 <code>NID_SES</code> 값 복사 후 붙여넣기</p>
                        </div>
                    )}

                    <div className="cookie-inputs">
                        <div className="input-group">
                            <label>NID_AUT</label>
                            <div className="input-wrapper">
                                <span className="input-icon">🔑</span>
                                <input
                                    type="password"
                                    placeholder="NID_AUT 값 붙여넣기"
                                    value={nidAut}
                                    onChange={(e) => setNidAut(e.target.value)}
                                    disabled={downloading}
                                />
                            </div>
                        </div>
                        <div className="input-group">
                            <label>NID_SES</label>
                            <div className="input-wrapper">
                                <span className="input-icon">🔑</span>
                                <input
                                    type="password"
                                    placeholder="NID_SES 값 붙여넣기"
                                    value={nidSes}
                                    onChange={(e) => setNidSes(e.target.value)}
                                    disabled={downloading}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="options-row">
                    <div className="input-group">
                        <label>Quality</label>
                        <select value={quality} onChange={(e) => setQuality(e.target.value)} disabled={downloading}>
                            <option value="best">Best (최고화질)</option>
                            <option value="1080">1080p</option>
                            <option value="720">720p</option>
                            <option value="480">480p</option>
                        </select>
                    </div>
                </div>

                <button
                    className="download-btn"
                    onClick={handleDownload}
                    disabled={downloading || !url}
                >
                    {downloading ? '⏳ 다운로드 중...' : '⬇️ 다운로드 시작'}
                </button>

                {(downloading || logs.length > 0) && (
                    <div className="progress-container">
                        <div className="progress-info">
                            <span>{status}</span>
                            <span>{progress.toFixed(1)}%</span>
                        </div>
                        <div className="progress-bar-bg">
                            <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
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
