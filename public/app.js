const { useState, useEffect, useRef } = React;

const BOOKMARKLET_CODE = `javascript:(function(){var a=document.cookie.match(/NID_AUT=([^;]+)/),s=document.cookie.match(/NID_SES=([^;]+)/);if(!a||!s){alert('쿠키 자동 읽기 실패\\nNID_AUT와 NID_SES를 직접 복사해주세요.');return;}var u='${window.location.origin}/#ck='+encodeURIComponent(a[1]+'|'+s[1]);window.open(u,'_blank');})();`;

function App() {
    const [tab, setTab] = useState('download');

    // 공유 쿠키 (localStorage 유지)
    const [nidAut, setNidAut] = useState(() => localStorage.getItem('nid_aut') || '');
    const [nidSes, setNidSes] = useState(() => localStorage.getItem('nid_ses') || '');
    const [soopCookie, setSoopCookie] = useState(() => localStorage.getItem('soop_cookie') || '');
    const [showCookieHelp, setShowCookieHelp] = useState(false);
    const [cookieCheckState, setCookieCheckState] = useState(null); // null | 'checking' | 'valid' | 'invalid'
    const [cookieCheckMsg, setCookieCheckMsg] = useState('');
    const [bookmarkletCopied, setBookmarkletCopied] = useState(false);
    const [cookieSavedNotice, setCookieSavedNotice] = useState(false);

    // 백그라운드 다운로드 작업 (확장 프로그램 연동용)
    const [activeJobs, setActiveJobs] = useState([]);

    useEffect(() => {
        const pollJobs = async () => {
            try {
                const res = await fetch('/api/active-jobs');
                if (res.ok) {
                    const data = await res.json();
                    setActiveJobs(data);
                }
            } catch (e) {
                console.error('Failed to poll active jobs:', e);
            }
        };
        pollJobs();
        const interval = setInterval(pollJobs, 2000);
        return () => clearInterval(interval);
    }, []);

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

    // 북마클릿으로 전달된 쿠키 처리 (#ck=NID_AUT|NID_SES)
    useEffect(() => {
        const hash = window.location.hash;
        if (hash.startsWith('#ck=')) {
            try {
                const decoded = decodeURIComponent(hash.slice(4));
                const [aut, ses] = decoded.split('|');
                if (aut && ses) {
                    setNidAut(aut);
                    setNidSes(ses);
                    setCookieSavedNotice(true);
                    setTimeout(() => setCookieSavedNotice(false), 4000);
                }
            } catch {}
            history.replaceState(null, '', window.location.pathname);
        }
    }, []);

    useEffect(() => { localStorage.setItem('nid_aut', nidAut); }, [nidAut]);
    useEffect(() => { localStorage.setItem('nid_ses', nidSes); }, [nidSes]);
    useEffect(() => { localStorage.setItem('soop_cookie', soopCookie); }, [soopCookie]);

    const hasCookie = !!(nidAut && nidSes);
    const isSoopUrl = (u) => /soop\.com|sooplive\.co\.kr/.test(u);

    const checkCookie = async () => {
        if (!hasCookie) return;
        setCookieCheckState('checking');
        setCookieCheckMsg('');
        try {
            const res = await fetch('/api/check-cookie', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nidAut, nidSes })
            });
            const data = await res.json();
            setCookieCheckState(data.valid ? 'valid' : 'invalid');
            setCookieCheckMsg(data.message || '');
        } catch {
            setCookieCheckState('invalid');
            setCookieCheckMsg('확인 중 오류가 발생했습니다.');
        }
    };

    const clearCookie = () => {
        setNidAut('');
        setNidSes('');
        setCookieCheckState(null);
        setCookieCheckMsg('');
    };

    const copyBookmarklet = () => {
        navigator.clipboard.writeText(BOOKMARKLET_CODE).then(() => {
            setBookmarkletCopied(true);
            setTimeout(() => setBookmarkletCopied(false), 2000);
        });
    };

    // PIN / QR 공유
    const [pin, setPin] = useState('');
    const [pinLoading, setPinLoading] = useState(false);
    const [showShare, setShowShare] = useState(false);

    const [pinInput, setPinInput] = useState('');
    const [pinLoadMsg, setPinLoadMsg] = useState('');
    const [pinLoadLoading, setPinLoadLoading] = useState(false);

    const generatePin = async () => {
        if (!hasCookie) return;
        setPinLoading(true);
        try {
            const res = await fetch('/api/pin/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nidAut, nidSes })
            });
            const data = await res.json();
            if (data.pin) { setPin(data.pin); setShowShare(true); }
        } catch {}
        setPinLoading(false);
    };

    const loadPin = async () => {
        const code = pinInput.trim();
        if (code.length !== 6) return setPinLoadMsg('6자리 코드를 입력해주세요.');
        setPinLoadLoading(true);
        setPinLoadMsg('');
        try {
            const res = await fetch('/api/pin/load', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: code })
            });
            const data = await res.json();
            if (res.ok && data.nidAut) {
                setNidAut(data.nidAut);
                setNidSes(data.nidSes);
                setPinInput('');
                setCookieSavedNotice(true);
                setTimeout(() => setCookieSavedNotice(false), 4000);
                setPinLoadMsg('');
            } else {
                setPinLoadMsg(data.error || '코드를 불러오지 못했습니다.');
            }
        } catch {
            setPinLoadMsg('오류가 발생했습니다.');
        }
        setPinLoadLoading(false);
    };

    const qrUrl = pin
        ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(window.location.origin + '/?pin=' + pin)}&bgcolor=0b0e14&color=00ffa3&format=svg`
        : '';

    // URL 파라미터로 PIN 전달된 경우 자동 로드
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const urlPin = params.get('pin');
        if (urlPin && urlPin.length === 6) {
            setPinInput(urlPin);
            history.replaceState(null, '', window.location.pathname);
        }
    }, []);

    const isClip = url.includes('/clips/');
    const isSoop = isSoopUrl(url);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const addLog = (type, message) => {
        setLogs(prev => [...prev, { type, message, id: Date.now() + Math.random() }]);
    };

    const handleDownload = async () => {
        if (!url) return alert('URL을 입력해주세요.');
        if (!url.includes('chzzk.naver.com') && !isSoopUrl(url)) return alert('치지직 또는 숲(soop.com) URL만 가능합니다.');
        if (isClip && (!nidAut || !nidSes)) return alert('클립 다운로드에는 NID_AUT와 NID_SES가 필요합니다.');

        setDownloading(true);
        setProgress(0);
        setLogs([]);
        setStatus('처리 중...');

        try {
            const response = await fetch('/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, quality, nidAut, nidSes, soopCookie })
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
                <p className="subtitle">{isSoop ? '🌲 숲(SOOP) + 치지직 고화질 영상 다운로더' : '치지직 + 숲 고화질 영상 다운로더'}</p>

                {cookieSavedNotice && (
                    <div className="cookie-saved-toast">✅ 쿠키가 자동으로 저장되었습니다!</div>
                )}

                <div className="cookie-section">
                    <div className="cookie-header">
                        <span>
                            🔐 네이버 인증 쿠키
                            <span className="optional"> (구독자 전용 · 클립 다운로드에 필요)</span>
                            {hasCookie && <span className="cookie-saved-badge">저장됨</span>}
                        </span>
                        <div className="cookie-header-actions">
                            {hasCookie && (
                                <button className="cookie-action-btn check-btn" onClick={checkCookie} disabled={cookieCheckState === 'checking'}>
                                    {cookieCheckState === 'checking' ? '확인 중...' : '유효성 확인'}
                                </button>
                            )}
                            {hasCookie && (
                                <button className="cookie-action-btn clear-btn" onClick={clearCookie}>초기화</button>
                            )}
                            <button className="help-btn" onClick={() => setShowCookieHelp(!showCookieHelp)}>
                                {showCookieHelp ? '닫기' : '?'}
                            </button>
                        </div>
                    </div>

                    {cookieCheckState && cookieCheckState !== 'checking' && (
                        <div className={`cookie-check-result ${cookieCheckState}`}>
                            {cookieCheckState === 'valid' ? '✅' : '❌'} {cookieCheckMsg}
                        </div>
                    )}

                    {showCookieHelp && (
                        <div className="cookie-help">
                            <div className="help-section">
                                <strong>🚀 자동 방법 (북마클릿)</strong>
                                <p>① 아래 버튼으로 북마클릿 코드 복사 → 브라우저 북마크에 추가</p>
                                <p>② <strong>chzzk.naver.com</strong>에 로그인 후 북마클릿 클릭 → 자동 저장!</p>
                                <button className="bookmarklet-btn" onClick={copyBookmarklet}>
                                    {bookmarkletCopied ? '✅ 복사됨!' : '📋 북마클릿 코드 복사'}
                                </button>
                                <p className="help-note">북마클릿 추가: 복사 후 브라우저 북마크 관리자에서 새 북마크 → URL에 붙여넣기</p>
                            </div>
                            <div className="help-divider">또는 수동으로</div>
                            <p>① Chrome에서 <strong>chzzk.naver.com</strong>에 로그인</p>
                            <p>② <code>F12</code> → <strong>Application</strong> → <strong>Cookies</strong> → <code>https://chzzk.naver.com</code></p>
                            <p>③ <code>NID_AUT</code>와 <code>NID_SES</code> 값 복사 후 붙여넣기</p>
                            <p className="help-note">💾 한 번 입력하면 자동으로 저장되어 다음에 다시 입력할 필요 없어요</p>
                        </div>
                    )}
                    {!isSoop && <div className="cookie-inputs">
                        <div className="input-group">
                            <label>NID_AUT</label>
                            <div className="input-wrapper">
                                <span className="input-icon">🔑</span>
                                <input type="password" placeholder="NID_AUT 값 붙여넣기"
                                    value={nidAut} onChange={e => { setNidAut(e.target.value); setCookieCheckState(null); }} />
                            </div>
                        </div>
                        <div className="input-group">
                            <label>NID_SES</label>
                            <div className="input-wrapper">
                                <span className="input-icon">🔑</span>
                                <input type="password" placeholder="NID_SES 값 붙여넣기"
                                    value={nidSes} onChange={e => { setNidSes(e.target.value); setCookieCheckState(null); }} />
                            </div>
                        </div>
                    </div>}
                    {isSoop && <div className="cookie-inputs">
                        <div className="input-group">
                            <label>🌲 숲(SOOP) 쿠키 <span className="optional">(선택 · 성인/구독자 전용 영상에 필요)</span></label>
                            <div className="input-wrapper">
                                <span className="input-icon">🔑</span>
                                <input type="password" placeholder="PHPSESSID=xxx (F12→Application→Cookies→soop.com에서 복사)"
                                    value={soopCookie} onChange={e => setSoopCookie(e.target.value)} />
                            </div>
                        </div>
                    </div>}
                </div>

                {/* PIN / QR 공유 섹션 */}
                <div className="share-section">
                    {hasCookie ? (
                        <div>
                            <button className="share-toggle-btn" onClick={generatePin} disabled={pinLoading}>
                                {pinLoading ? '⏳ 코드 생성 중...' : '📲 모바일로 공유 (PIN · QR)'}
                            </button>
                            {showShare && pin && (
                                <div className="share-box">
                                    <div className="share-pin-label">6자리 공유 코드 <span className="share-ttl">(1시간 유효 · 1회용)</span></div>
                                    <div className="share-pin">{pin}</div>
                                    <div className="share-qr">
                                        <img src={qrUrl} alt="QR 코드" width="150" height="150" />
                                        <p className="share-qr-hint">QR 스캔 → 자동 입력</p>
                                    </div>
                                    <p className="share-hint">모바일에서 코드를 입력하거나 QR을 스캔하세요</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="pin-input-row">
                            <input
                                className="pin-input"
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                placeholder="PC에서 받은 6자리 코드"
                                value={pinInput}
                                onChange={e => { setPinInput(e.target.value.replace(/\D/g, '')); setPinLoadMsg(''); }}
                                onKeyDown={e => e.key === 'Enter' && loadPin()}
                            />
                            <button className="pin-load-btn" onClick={loadPin} disabled={pinLoadLoading || pinInput.length !== 6}>
                                {pinLoadLoading ? '⏳' : '불러오기'}
                            </button>
                        </div>
                    )}
                    {pinLoadMsg && <div className="pin-error">{pinLoadMsg}</div>}
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
                                    placeholder="https://chzzk.naver.com/clips/... 또는 /video/... 또는 숲(soop.com) URL"
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

                {/* 백그라운드 다운로드 목록 (익스텐션 연동) */}
                {activeJobs.length > 0 && (
                    <div className="active-jobs-section">
                        <h3 className="section-title">⚡ 백그라운드 다운로드 진행 상황 <span className="title-desc">(익스텐션 연동됨)</span></h3>
                        <div className="active-jobs-list">
                            {activeJobs.map(job => (
                                <div key={job.token} className="active-job-item">
                                    <div className="job-meta">
                                        <span className="job-url" title={job.url}>{job.url}</span>
                                        <span className={`job-status-badge ${job.status}`}>
                                            {job.status === 'running' ? '⏳ 다운로드 중' : job.status === 'done' ? '✅ 완료' : '❌ 오류'}
                                        </span>
                                    </div>
                                    <div className="job-progress-row">
                                        <div className="job-progress-bar-bg">
                                            <div className={`job-progress-bar-fill ${job.status}`} style={{ width: `${job.progress}%` }}></div>
                                        </div>
                                        <span className="job-progress-pct">{job.progress.toFixed(0)}%</span>
                                    </div>
                                    {job.log && <div className="job-log">{job.log}</div>}
                                    {job.status === 'done' && (
                                        <button className="job-save-btn" onClick={() => triggerDownload(`/file/${job.token}`)}>
                                            ⬇️ 내 PC에 저장
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
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
