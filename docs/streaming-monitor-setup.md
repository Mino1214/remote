# Streaming Monitor (CCTV-style) 운영 런북

이 문서는 합법적인 사내/개인 디바이스 모니터링 목적의 항상-송출 스트리밍 시스템을
구축하고 운영하는 절차입니다. 무단 모니터링은 법적 책임을 동반합니다 — 본 시스템은
다음 4가지 안전선을 코드 수준에서 강제합니다.

## 안전선 (Hard Constraints)

| # | 항목 | 어디에 박혀 있나 |
|---|---|---|
| 1 | 명시적 동의 다이얼로그 통과 후에만 ACTIVE | `streams/auth` 콜백이 `consentAcceptedAt` 필수 검증 |
| 2 | 항상 표시되는 REC (트레이 + 우상단 워터마크 + 영상 내 drawtext) | agent의 indicator form + ffmpeg drawtext, agent-config의 4개 lock 필드 |
| 3 | 정상 OS 권한만 사용 (LocalSystem 금지, gdigrab 사용자 데스크톱) | `install.ps1`이 ONLOGON Task만 등록, RL LIMITED |
| 4 | 사용자가 일시정지/철회 가능, 관리자는 강제 재개 불가 | `pause/resume`은 ingestSecret 인증, 관리자 세션은 revoke만 |

## 아키텍처 (재게재)

```text
[Windows Client]                     [Server (Mac/Linux Docker)]
┌────────────────────┐               ┌───────────────────────────┐
│ StreamMonitor      │   RTMP push   │ MediaMTX (1935 ingest)    │
│  Agent (PS+ffmpeg) ├──────────────▶│  ↓ HLS 8888 / WebRTC 8889 │
│  ● REC indicator   │               │  ↓ /recordings volume     │
└────────────────────┘               │                           │
        ▲                            │ Dashboard (Next.js, 3010) │
        │ pause/resume/consent       │  /api/streams/auth ←──────┤
        └────────────────────────────│  /api/streams/{id}/...    │
                                     │  /devices/{id}/live       │
                                     │  /devices/{id}/recordings │
                                     └───────────────────────────┘
```

## 1) 서버 측 1회 셋업

### 1-1) 환경변수
`docker/.env`에 다음 신규 시크릿 추가 (이미 `.env.example`에 템플릿 있음):

```env
STREAM_INGEST_SHARED_SECRET=<32+ 랜덤>
STREAM_PLAYBACK_TOKEN_SECRET=<32+ 랜덤>
STREAM_PLAYBACK_TOKEN_TTL=600
STREAM_AUTH_TRUSTED_HOSTS=mediamtx
STREAM_RECORDINGS_DEFAULT_RETENTION_DAYS=7
STREAM_PLAYBACK_HLS_BASE=http://localhost:8888
STREAM_WATERMARK_DEFAULT=● REC | 관리자 모니터링 활성화
```

### 1-2) Prisma 마이그레이션
```bash
cd dashboard
npx prisma migrate dev --name add_streaming_monitor
# 또는 운영 환경:
npx prisma migrate deploy
```

### 1-3) 컨테이너 기동
```bash
cd docker
docker compose up -d mediamtx dashboard
docker compose logs -f mediamtx | head
```

기대치:
- mediamtx 로그에 "RTMP listener opened on :1935", "HLS listener opened on :8888"
- 첫 ingest 시도 시 mediamtx가 dashboard `/api/streams/auth`로 콜백 → 200 또는 401

### 1-4) 외부 노출 (외부망 클라이언트 시)
공유기 포트포워딩 추가 (이 Mac LAN IP `192.168.219.112` 기준):

| 외부 포트 | Protocol | 용도 |
|---|---|---|
| 1935 | TCP | RTMP ingest (agent push) |
| 8888 | TCP | HLS playback (브라우저/관리자) |
| 8889 | TCP | WebRTC signaling (옵션) |
| 8189 | UDP | WebRTC media (옵션) |

> HLS/WebRTC를 외부에 직접 열지 말고 cloudflared 등의 reverse proxy 뒤에 두는 것을 강력 권장.
> playback 토큰이 있긴 하지만 IP 노출은 최소화가 원칙.

## 2) 디바이스 등록 → 스트림 발급

### 2-1) DeviceMeta 생성
관리자 콘솔 `/devices/<rustdeskId>` 에서 별칭 한 번 저장.

### 2-2) 스트림 등록
같은 페이지의 "모니터링 스트림" 카드 → 표시이름/보존일수 입력 → 등록.

응답에 표시되는 다음 3개를 즉시 안전한 채널로 클라이언트 운영자에게 전달:
- `streamKey` (s_xxx)
- `ingestSecret` (base64url 24바이트)
- 스트림 `id` (cuid)

> ingestSecret은 한 번만 표시됩니다. 다시 안 보입니다 (DB에는 sha256 해시만 저장).

### 2-3) 상태
이 시점 스트림은 PENDING. mediamtx가 ingest 시도를 거부합니다.

## 3) 클라이언트 PC에 agent 설치

### 3-1) 빌드 (운영자 PC)
Inno Setup으로 패키징:

```powershell
cd client-fork\streaming-agent
iscc setup.iss `
  /DAgentVersion=0.1.0 `
  /DDashboardBase=https://admin.housingnewshub.info `
  /DStreamId=<위에서 받은 cuid> `
  /DIngestSecret=<위에서 받은 비밀> `
  /DStreamKey=<위에서 받은 streamKey> `
  /DRtmpBase=rtmp://relay.housingnewshub.info:1935 `
  /DAdminContact=admin@example.com `
  /DWatermarkText="● REC | 회사명 모니터링 활성화"
```

`streammonitor-agent-setup.exe` 산출물.

### 3-2) 클라이언트 PC에서 설치
1. 사용자 / IT 담당자가 setup.exe 실행 → 관리자 권한 동의
2. 설치 완료 후 다음 사용자 로그인 시 동의 다이얼로그 자동 표시
3. 즉시 시작하려면:
```powershell
Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\StreamMonitor\Start-StreamAgent.ps1"'
```

### 3-3) 사용자 동의
다이얼로그가 뜨면:
- 안내문 정독 (수집 범위/표시/권한/철회 등)
- 동의자 이름/사번 입력
- 체크박스 활성화 → "동의함" 클릭

이 시점에서 dashboard로 consent 콜이 가서 스트림이 ACTIVE로 전환되고 ingest가 시작됩니다.

## 4) 시청 (관리자)

`/devices/<rustdeskId>/live` → "● 시청 시작" 버튼.

- 시청 시각/시청자 이메일이 audit log에 기록됩니다.
- 클라이언트 화면에는 워터마크가 박혀 사후 식별 가능합니다.

녹화 목록은 `/devices/<rustdeskId>/recordings`. 다운로드 엔드포인트는 보존정책/감사 별도 구현 필요(추후).

## 5) 사용자 측 일시정지/철회

- **일시정지**: 트레이 우클릭 → "일시정지". 즉시 ffmpeg 종료 + dashboard에 PAUSED 기록. 관리자 콘솔에서 시청 시도 시 "stream is PAUSED" 표시.
- **재개**: 같은 메뉴 → "재개". ingestSecret 인증 후 재시작.
- **철회 (영구)**: 트레이 → "동의 철회". 로컬 동의 플래그 삭제 + 즉시 ingest 종료. 관리자가 강제 재개할 수 없으며, 다시 활성화하려면 관리자가 새 streamKey/ingestSecret을 발급해 재배포해야 합니다.

## 6) 트러블슈팅

| 증상 | 원인 / 조치 |
|---|---|
| 동의 다이얼로그가 뜨지 않음 | Task Scheduler에 `StreamMonitorAgent` 등록되어 있는지 확인. RL LIMITED, ONLOGON 트리거 |
| 라이브 페이지 "stream is PENDING" | agent에서 동의 미완료. 다이얼로그를 다시 띄우려면 `%PROGRAMDATA%\StreamMonitor\consent-<streamId>.json` 삭제 후 agent 재시작 |
| ffmpeg 무한 재시작 | `agent.log` 확인. 일반적인 원인: ffmpeg.exe 경로 오류, RTMP URL 오타, 네트워크 차단 |
| 워터마크가 안 보임 | drawtext 필터 escape 이슈. 워터마크 문구에 콜론 등 특수문자 사용 시 이중 escape |
| HLS 재생 안 됨 (CORS) | mediamtx.yml `hlsAllowOrigin: '*'` 또는 reverse proxy에서 CORS 헤더 추가 |
| 인증 콜백 401 반복 | `STREAM_AUTH_TRUSTED_HOSTS` 가 mediamtx 컨테이너 호스트네임을 포함하는지 확인. docker-compose의 service 이름 = mediamtx |

## 7) 보안/감사 체크리스트

- [ ] `.env` 의 두 시크릿(STREAM_INGEST_SHARED_SECRET, STREAM_PLAYBACK_TOKEN_SECRET)는 32바이트 이상 랜덤
- [ ] DB 백업/유출 시 ingestSecret이 평문이 아닌 sha256 해시로만 저장되어 있는지 확인
- [ ] dashboard `/api/streams/auth` 가 mediamtx 컨테이너 외부에서 호출 시 403 반환되는지 검증
- [ ] HLS 토큰 TTL이 너무 길지 않은지 (기본 600s) — 시청 행위 추적 단위
- [ ] 모든 이벤트가 audit log에 남는지 확인 (등록/동의/일시정지/재개/철회/시청/녹화)
- [ ] 보존기간 만료 녹화 자동 삭제 (mediamtx `recordDeleteAfter` + 별도 cron)
- [ ] 관리자 라우트(/streams, /devices/*/live) 가 IP allowlist + Cloudflare Access 뒤에 있는지

## 8) 법적/윤리 체크리스트 (운영 전 반드시 확인)

- [ ] 모니터링 대상 사용자에게 사전 서면 고지 + 동의 (취업규칙 + 별도 동의서)
- [ ] 한국 정보통신망법 49조 위반 가능성 검토 (타인 정보 침해)
- [ ] 통신비밀보호법 14조 적용 검토 (감청·녹음 금지)
- [ ] 근로기준법 시행령 등 사업장 모니터링 가이드 준수
- [ ] 개인정보 처리방침에 영상 수집/보존/이용/파기 명시
- [ ] 영상 접근 권한 분리 (관리자 직책별)
- [ ] 정기 감사 (audit log 검토 주기, 시청 패턴 이상치 탐지)

본 시스템 운영 책임은 운영자 본인에게 있습니다. 본 코드/문서는 "감시" 도구가 아니라
"동의 기반의 투명한 모니터링" 도구로 설계되어 있으며, 안전선을 우회/제거하는 변경을
가하는 순간 본 프로젝트의 본래 목적과 결별합니다.
