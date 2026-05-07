const { useState, useEffect, useRef } = React;

function App() {
    const [tab, setTab] = useState('download');

    // 공유 쿠키 (localStorage 유지)
    const [nidAut, setNidAut] = useState(() => localStorage.getItem('nid_aut') || '');
    const [nidSes, setNidSes] = useState(() => localStorage.getItem('nid_ses') || '');
    const [showCookieHelp, setShowCookieHelp] = useState(false);

    // 다운로드 탭
    const [url, setUrl] = useState('');
    const [quality, setQuality] = useState('best');
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('Ready');
    const [logs, setLogs] = useState([]);
    const logEndRef = useRef(null);

    // 채널 클립 탭
    const [channelInput, setChannelInput] = useState('');
    const [clips, setClips] = useState([]);
    const [clipsLoading, setClipsLoading] = useState(false);
    const [clipsError, setClipsError] = useState('');
    const [nextCursor, setNextCursor] = useState(null);
    const [hasNext, setHasNext] = useState(false);
    const [totalLoaded, setTotalLoaded] = useState(0);
    const [clipStatus, setClipStatus] = useState({});

    useEffect(() => { localStorage.setItem('nid_aut', nidAut); }, [nidAut]);
    useEffect(() => { localStorage.setItem('nid_ses', nidSes); }, [nidSes]);

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

            await readSSE(response, {
                onLog: msg => addLog('stdout', msg),
                onErr: msg => addLog('stderr', msg),
                onProgress: p => setProgress(p),
                onFileReady: token => {
                    setStatus('파일 준비 완료! 저장 중...');
                    setProgress(100);
                    triggerDownload(`/file/${token}`);
                },
                onDone: ok => {
                    setStatus(ok ? '✅ 완료!' : '❌ 오류 발생');
                    setDownloading(false);
                }
            });
        } catch (error) {
            addLog('stderr', error.message);
            setStatus('❌ 오류');
            setDownloading(false);
        }
    };

    const loadClips = async (reset = false) => {
        if (!channelInput.trim()) return;
        setClipsLoading(true);
        setClipsError('');
        if (reset) { setClips([]); setNextCursor(null); setTotalLoaded(0); }

        try {
            const params = new URLSearchParams({ channelId: channelInput.trim(), size: '20', nidAut, nidSes });
            if (!reset && nextCursor) params.set('cursor', nextCursor);

            const res = await fetch(`/api/channel-clips?${params}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '클립 목록을 불러오지 못했습니다.');

            setClips(prev => reset ? data.clips : [...prev, ...data.clips]);
            setNextCursor(data.nextCursor);
            setHasNext(data.hasNext);
            setTotalLoaded(prev => reset ? data.clips.length : prev + data.clips.length);
        } catch (err) {
            setClipsError(err.message);
        } finally {
            setClipsLoading(false);
        }
    };

    const downloadChannelClip = async (clip) => {
        const clipId = clip.clipUID || clip.clipUid || clip.clipId || clip.id;
        if (!clipId) return;
        if (!nidAut || !nidSes) { alert('클립 다운로드에는 위의 NID_AUT와 NID_SES 쿠키가 필요합니다.'); return; }

        setClipStatus(prev => ({ ...prev, [clipId]: 'loading' }));

        try {
            const response = await fetch('/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://chzzk.naver.com/clips/${clipId}`, quality: 'best', nidAut, nidSes })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || '요청 실패');
            }

            await readSSE(response, {
                onFileReady: token => triggerDownload(`/file/${token}`),
                onDone: ok => {
                    setClipStatus(prev => ({ ...prev, [clipId]: ok ? 'done' : 'error' }));
                    setTimeout(() => setClipStatus(prev => { const n = { ...prev }; delete n[clipId]; return n; }), 3000);
                }
            });
        } catch {
            setClipStatus(prev => ({ ...prev, [clipId]: 'error' }));
            setTimeout(() => setClipStatus(prev => { const n = { ...prev }; delete n[clipId]; return n; }), 3000);
        }
    };

    return (
        <div className="container">
            <div className="glass-card">
                <h1>CHZZK DL</h1>
                <p className="subtitle">치지직 고화질 영상 다운로더</p>

                <div className="cookie-section">
                    <div className="cookie-header">
                        <span>🔐 네이버 인증 쿠키 <span className="optional">(구독자 전용 · 클립 다운로드에 필요)</span></span>
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
                                <input type="password" placeholder="NID_AUT 값 붙여넣기"
                                    value={nidAut} onChange={e => setNidAut(e.target.value)} />
                            </div>
                        </div>
                        <div className="input-group">
                            <label>NID_SES</label>
                            <div className="input-wrapper">
                                <span className="input-icon">🔑</span>
                                <input type="password" placeholder="NID_SES 값 붙여넣기"
                                    value={nidSes} onChange={e => setNidSes(e.target.value)} />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="tab-bar">
                    <button className={`tab-btn${tab === 'download' ? ' active' : ''}`} onClick={() => setTab('download')}>⬇ URL 다운로드</button>
                    <button className={`tab-btn${tab === 'channel' ? ' active' : ''}`} onClick={() => setTab('channel')}>📋 채널 클립</button>
                </div>

                {tab === 'download' && (
                    <div>
                        <div className="input-group">
                            <label>Video URL</label>
                            <div className="input-wrapper">
                                <span className="input-icon">🔗</span>
                                <input type="text"
                                    placeholder="https://chzzk.naver.com/clips/... 또는 /video/..."
                                    value={url} onChange={e => setUrl(e.target.value)}
                                    disabled={downloading} />
                            </div>
                        </div>

                        <div className="options-row">
                            <div className="input-group">
                                <label>Quality</label>
                                <select value={quality} onChange={e => setQuality(e.target.value)} disabled={downloading}>
                                    <option value="best">Best (최고화질)</option>
                                    <option value="1080">1080p</option>
                                    <option value="720">720p</option>
                                    <option value="480">480p</option>
                                </select>
                            </div>
                        </div>

                        <button className="download-btn" onClick={handleDownload} disabled={downloading || !url}>
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
                                        <div key={log.id} className={`log-line ${log.type}`}>{log.message}</div>
                                    ))}
                                    <div ref={logEndRef} />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {tab === 'channel' && (
                    <div>
                        <div className="channel-input-row">
                            <div className="input-wrapper" style={{ flex: 1 }}>
                                <span className="input-icon">📡</span>
                                <input type="text"
                                    placeholder="https://chzzk.naver.com/8421eba6..."
                                    value={channelInput}
                                    onChange={e => setChannelInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && loadClips(true)}
                                    disabled={clipsLoading} />
                            </div>
                            <button className="load-btn" onClick={() => loadClips(true)} disabled={clipsLoading || !channelInput}>
                                {clipsLoading && clips.length === 0 ? '⏳' : '불러오기'}
                            </button>
                        </div>

                        {clipsError && <div className="clips-error">❌ {clipsError}</div>}

                        {clips.length === 0 && !clipsLoading && !clipsError && (
                            <div className="clips-empty">채널 URL을 입력하고 불러오기를 클릭하세요</div>
                        )}

                        {clips.length > 0 && (
                            <div>
                                <div className="clips-header">
                                    <span className="clips-count">{totalLoaded}개 로드됨</span>
                                </div>
                                <div className="clip-list">
                                    {clips.map(clip => {
                                        const clipId = clip.clipUID || clip.clipUid || clip.clipId || clip.id;
                                        const st = clipStatus[clipId];
                                        return (
                                            <div className="clip-item" key={clipId}>
                                                {clip.thumbnailImageUrl
                                                    ? <img className="clip-thumb" src={clip.thumbnailImageUrl} onError={e => e.target.style.display = 'none'} />
                                                    : <div className="clip-thumb-placeholder" />
                                                }
                                                <div className="clip-info">
                                                    <div className="clip-title">{clip.clipTitle || '제목 없음'}</div>
                                                    <div className="clip-meta">
                                                        {[clip.channel?.channelName, clip.duration ? fmtDur(clip.duration) : null].filter(Boolean).join('  •  ')}
                                                    </div>
                                                    <button
                                                        className={`clip-dl-btn${st === 'done' ? ' done' : st === 'error' ? ' err' : ''}`}
                                                        onClick={() => downloadChannelClip(clip)}
                                                        disabled={!!st}>
                                                        {st === 'loading' ? '⏳ 다운로드 중...' : st === 'done' ? '✅ 완료!' : st === 'error' ? '❌ 실패' : '⬇ 다운로드'}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {hasNext && (
                                    <button className="load-more-btn" onClick={() => loadClips(false)} disabled={clipsLoading}>
                                        {clipsLoading ? '⏳ 불러오는 중...' : '더 불러오기'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function fmtDur(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function triggerDownload(href) {
    const a = document.createElement('a');
    a.href = href;
    a.click();
}

async function readSSE(response, { onLog, onErr, onProgress, onFileReady, onDone } = {}) {
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
                if (type === 'log') onLog?.(data);
                else if (type === 'err') onErr?.(data);
                else if (type === 'progress') onProgress?.(typeof data === 'number' ? data : 0);
                else if (type === 'file_ready') onFileReady?.(data);
                else if (type === 'done') onDone?.(data === 'OK');
            } catch {}
        }
    }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
