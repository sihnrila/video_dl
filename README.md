# CHZZK DL (치지직 다운로더)

치지직(CHZZK)의 VOD 및 클립 영상을 쉽게 다운로드할 수 있는 데스크톱 애플리케이션(Electron) 및 크롬 익스텐션입니다.

## 기능
- 치지직 VOD / 클립 고화질 다운로드 지원
- **Electron 데스크톱 앱**: 일반 윈도우/맥 프로그램처럼 설치 및 실행
- 백그라운드에서 OS에 맞는 `yt-dlp` 자동 다운로드 및 업데이트
- 앱 내부에 `ffmpeg` 바이너리 내장으로 별도 설치 불필요
- **크롬 익스텐션 연동**: 브라우저에서 버튼 클릭으로 바로 다운로드 가능

## 💻 빌드 및 실행 방법

### 1. 사전 준비 (개발자용)
- [Node.js](https://nodejs.org/) (버전 18 이상 권장)

### 2. 패키지 설치
이 프로젝트를 클론하거나 다운로드 받은 후 터미널에서 다음 명령어를 실행합니다.

```bash
npm install
```

### 3. 로컬 테스트 실행
Electron 개발 모드로 앱을 띄웁니다.
```bash
npm run start:electron
```

### 4. 데스크톱 앱(설치 파일) 빌드
현재 사용 중인 운영체제에 맞는 설치 파일을 만들어냅니다.

- **Mac용 빌드 (.dmg)**
  ```bash
  npm run build:mac
  ```
- **Windows용 빌드 (.exe)**
  ```bash
  npm run build:win
  ```

> **⚠️ 주의사항 (크로스 컴파일 관련)**
> Mac에서 `npm run build:win`을 실행해 Windows용을 만들 경우, Mac용 `ffmpeg` 바이너리가 패키징되어 윈도우에서 영상 합성 시 오류가 발생할 수 있습니다. 
> 완벽한 Windows 배포용 `.exe`를 만들려면 실제 Windows 환경에서 코드를 내려받고 `npm install` 후 `npm run build:win`을 진행하세요.

## 구조 설명
- `server.js`: 백엔드 다운로드 로직 및 로컬 API 서버
- `main.js`: Electron 데스크톱 앱 메인 프로세스
- `ytdlp-manager.js`: OS에 맞는 최신 `yt-dlp` 자동 다운로드 모듈
- `public/`: 웹 브라우저 (데스크톱 앱 화면) 프론트엔드
- `chzzk-extension/`: 크롬 브라우저용 확장 프로그램 소스
