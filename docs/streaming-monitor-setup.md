# Streaming Monitor (CCTV-style) 운영 런북

이 문서는 합법적인 사내/개인 디바이스 모니터링 목적의 항상-송출 스트리밍 시스템을
구축하고 운영하는 절차입니다. 무단 모니터링은 법적 책임을 동반합니다 — 본 시스템은
다음 4가지 안전선을 코드 수준에서 강제합니다.

## 안전선 (Hard Constraints)

| # | 항목 | 어디에 박혀 있나 |
|---|---|---|
| 1 | 명시적 동의 다이얼로그 통과 후에만 ACTIVE | ingest 엔드포인트가 `consentAcceptedAt && status===ACTIVE` 검증 |
| 2 | 항상 표시되는 REC (트레이 + 우상단 워터마크 + 영상 내 drawtext) | agent의 indicator form + ffmpeg drawtext, agent-config의 4개 lock 필드 |
| 3 | 정상 OS 권한만 사용 (LocalSystem 금지, gdigrab 사용자 데스크톱) | `install.ps1`이 ONLOGON Task만 등록, RL LIMITED |
| 4 | 사용자가 일시정지/철회 가능, 관리자는 강제 재개 불가 | `pause/resume`은 ingestSecret 인증, 관리자 세션은 revoke만 |

## 아키텍처 — 포트포워딩 zero

```text
[Windows Client]                             [Server (Mac/Linux Docker)]
┌────────────────────────┐                   ┌────────────────────────────┐
│ StreamMonitor          │                   │  Cloudflare Tunnel         │
│  Agent (PS+ffmpeg)     │   HTTPS PUT       │     ↓                      │
│  ● REC indicator       ├──────────────────▶│  Dashboard (Next.js, 3010) │
│                        │ (chunked HLS)     │   /api/streams/ingest/...  │
│                        │                   │      ↓ /var/streams/<key>/ │
│                        │ HTTPS POST        │   /api/streams/{id}/...    │
│                        │ (consent/pause)   │   /api/streams/play/...    │
└────────────────────────┘                   │   /devices/{id}/live       │
                                             └────────────────────────────┘
                                                       ↑
                                                    HTTPS GET (HLS.js)
                                                       │
                                              [관리자 브라우저]
```

- 클라이언트 → outbound HTTPS만 사용 → 어떤 NAT/방화벽도 통과
- 서버 → 이미 cloudflared로 HTTPS 노출 중인 dashboard에 ingest API만 추가됨
- **결과: 클라/서버 양쪽 모두 공유기 포트포워딩 불필요**

## 1) 서버 측 1회 셋업

### 1-1) 환경변수
`docker/.env`에 다음 항목이 있어야 합니다 (`.env.example` 참고):

```env
STREAM_PLAYBACK_TOKEN_SECRET=<32+ 랜덤>
STREAM_PLAYBACK_TOKEN_TTL=600
STREAM_RECORDINGS_DEFAULT_RETENTION_DAYS=7
STREAM_PUBLIC_BASE=https://admin.housingnewshub.info
STREAM_WATERMARK_DEFAULT=● REC | 관리자 모니터링 활성화
```

### 1-2) Prisma 마이그레이션
```bash
cd dashboard
npx prisma migrate dev --name add_streaming_monitor   # 첫 1회
# 또는 운영 환경:
npx prisma migrate deploy
```

### 1-3) 컨테이너 기동
```bash
cd docker
docker compose up -d dashboard
docker compose logs -f dashboard | head
```

기대치:
- dashboard 컨테이너에 `streams_data` 볼륨이 `/var/streams`로 마운트됨
- `/api/streams/ingest/...` 와 `/api/streams/play/...` 가 응답하는지 확인

### 1-4) Cloudflare Tunnel 라우팅
이미 셋업된 호스트네임이 그대로 동작합니다. 추가 작업 없음.
- `admin.housingnewshub.info` → `http://127.0.0.1:3010` (dashboard, 모든 ingest/play API)

## 2) 디바이스 등록 → 스트림 발급

### 2-1) DeviceMeta 생성
관리자 콘솔 `/devices/<rustdeskId>` 에서 별칭 한 번 저장.

### 2-2) 스트림 등록
같은 페이지의 "모니터링 스트림" 카드 → 표시이름/보존일수 입력 → 등록.

응답에 표시되는 다음 3개를 즉시 안전한 채널로 클라이언트 운영자(또는 setup 빌드 입력값)에게 전달:
- 스트림 `id` (cuid)
- `streamKey` (s_xxxxxxxx)
- `ingestSecret` (base64url 24바이트)

> ingestSecret은 한 번만 표시됩니다. 다시 안 보입니다 (DB에는 sha256 해시만 저장).

### 2-3) 상태
이 시점 스트림은 PENDING. ingest 엔드포인트가 PUT 시도를 거부합니다.

## 3) 클라이언트 PC에 agent 설치

### 3-1) 빌드 (운영자 PC)
Inno Setup으로 패키징:

```powershell
cd client-fork\streaming-agent
iscc setup.iss `
  /DAgentVersion=0.1.0 `
  /DDashboardBase=https://admin.housingnewshub.info `
  /DStreamId=<위에서 받은 cuid> `
  /DStreamKey=<위에서 받은 streamKey> `
  /DIngestSecret=<위에서 받은 비밀> `
  /DAdminContact=admin@example.com `
  /DWatermarkText="● REC | 회사명 모니터링 활성화"
```

산출물: `streammonitor-agent-setup.exe`

> 이 .exe 하나에 모든 셋업이 들어 있습니다. 클라이언트 PC에서 더블클릭 + 관리자 동의 + 사용자 동의 다이얼로그가 끝.

### 3-2) 클라이언트 PC에서 설치
1. setup.exe 실행 → UAC 관리자 동의
2. 자동 진행:
   - `C:\Program Files\StreamMonitor\` 에 스크립트 복사
   - `agent-config.json` 빌드 시점 값으로 자동 생성
   - `ffmpeg.exe` 자동 다운로드 (gyan.dev essentials)
   - Task Scheduler `StreamMonitorAgent` ONLOGON / RL LIMITED 등록
3. 설치 완료 메시지 + 다음 사용자 로그인 시 동의 다이얼로그 표시 안내
4. 즉시 시작:
```powershell
Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\StreamMonitor\Start-StreamAgent.ps1"'
```

### 3-3) 사용자 동의
다이얼로그가 뜨면:
- 안내문 정독 (수집 범위/표시/권한/철회 등)
- 동의자 이름/사번 입력
- 체크박스 활성화 → "동의함" 클릭

→ dashboard로 consent 콜이 가서 ACTIVE 전환 + ingest 시작.
→ 화면 우상단 빨간 REC 인디케이터 항상 표시.
→ 시스템 트레이에 모니터링 아이콘 등장.

## 4) 시청 (관리자)

`/devices/<rustdeskId>/live` → "● 시청 시작" 버튼.

- HLS.js가 단명 HMAC 토큰을 매니페스트와 모든 .ts 세그먼트에 자동으로 붙여서 GET.
- 시청 시각/시청자 이메일이 audit log에 기록.
- 클라이언트 화면에는 워터마크가 박혀 사후 식별 가능.

녹화는 `/devices/<rustdeskId>/recordings` 에서 메타 조회. 실제 파일은 dashboard 컨테이너의 `/var/streams/<streamKey>/seg_*.ts`.

## 5) 사용자 측 일시정지/철회

| 동작 | 트레이 메뉴 | 결과 |
|---|---|---|
| 일시정지 | `일시정지` | ffmpeg 종료 + dashboard PAUSED. 시청 불가. |
| 재개 | `재개` | 같은 ingestSecret으로 ACTIVE 재전환 + ffmpeg 재시작 |
| 철회 | `동의 철회` | 로컬 동의 플래그 삭제 + dashboard PAUSED 사유 기록. 다시 활성화하려면 관리자가 새 streamKey/ingestSecret 발급 후 재배포 |

## 6) 트러블슈팅

| 증상 | 원인 / 조치 |
|---|---|
| 동의 다이얼로그가 뜨지 않음 | Task Scheduler `StreamMonitorAgent` 등록 확인. RL LIMITED, ONLOGON. |
| 라이브 페이지 "stream is PENDING" | agent에서 동의 미완료. `%PROGRAMDATA%\StreamMonitor\consent-<streamId>.json` 삭제 후 재시작하면 다이얼로그 재표시 |
| ffmpeg 무한 재시작 | `%PROGRAMDATA%\StreamMonitor\agent.log` 확인. 흔한 원인: 잘못된 ingestSecret, 네트워크 차단, dashboard URL 오타 |
| ingest 401 | dashboard 로그 확인. `Authorization: Bearer <secret>` 헤더가 올바른지, stream.status가 ACTIVE인지 |
| HLS 재생 끊김 | playback 토큰 TTL이 짧으면 자주 갱신됨. 기본 10분(STREAM_PLAYBACK_TOKEN_TTL=600). UI는 자동 갱신. |
| 워터마크가 안 보임 | drawtext 필터 escape 이슈. 워터마크 문구에 콜론 등 특수문자 사용 시 이중 escape (Invoke-Capture.ps1의 Escape-Drawtext 로직 확인) |

## 7) 보안/감사 체크리스트

- [ ] `.env` 의 `STREAM_PLAYBACK_TOKEN_SECRET` 는 32바이트 이상 랜덤
- [ ] DB 백업/유출 시 ingestSecret이 평문이 아닌 sha256 해시로만 저장되어 있는지 확인
- [ ] HLS 토큰 TTL이 너무 길지 않은지 (기본 600s) — 시청 행위 추적 단위
- [ ] 모든 이벤트가 audit log에 남는지 (등록/동의/일시정지/재개/철회/시청/녹화)
- [ ] 보존기간 만료된 `/var/streams/<key>/seg_*.ts` 정기 청소 cron 등록 (구현은 별도 운영 작업)
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
