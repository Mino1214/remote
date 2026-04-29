# Streaming Agent (Windows)

이 폴더는 **합법적인 사내/개인 디바이스 모니터링** 용도의 Windows 스트리밍 agent입니다.
무단 설치, 은닉 실행, 비동의 모니터링은 금지하며, 다음 4가지 안전장치를 코드 수준에서 보장합니다.

## 핵심 특징

- **포트포워딩 불필요**: 모든 트래픽이 outbound HTTPS. 클라/서버 어느 쪽도 공유기 설정 손볼 필요 없음.
- **별도 미디어 서버 없음**: ffmpeg가 dashboard로 직접 HLS chunked PUT. 인프라 한 덩어리만 운영.
- **exe 한 번이면 끝**: Inno Setup 설치 → 다음 로그인 시 동의 다이얼로그 자동 → 끝.

## 코드로 보장하는 안전선 4가지

1. **명시적 동의 다이얼로그** — `Show-ConsentDialog.ps1`이 첫 실행 시 사용자 입력을 받아야만 ACTIVE 전환.
2. **항상 표시되는 REC 인디케이터** — 시스템 트레이 빨간 점 + 화면 우상단 항상 위 떠있는 작은 워터마크 창. 사용자 임의 종료 가능.
3. **OS 권한 다이얼로그 정상 통과** — gdigrab는 사용자 데스크톱 권한만 사용. LocalSystem 서비스 미사용. 보안 SW 우회 절대 금지.
4. **사용자 일시정지/철회 권한** — 트레이 메뉴에서 즉시 일시정지 또는 동의 철회. 관리자는 강제 재개 불가.

## 구성

| 파일 | 역할 |
|---|---|
| `agent-config.example.json` | `streamId`, `streamKey`, `ingestSecret`, `dashboardBase` 등 |
| `Start-StreamAgent.ps1` | 메인 엔트리. 트레이 + 항상위 REC + ffmpeg 슈퍼바이저 |
| `Show-ConsentDialog.ps1` | 첫 실행 시 사용자 동의 다이얼로그 |
| `Invoke-Capture.ps1` | ffmpeg gdigrab → drawtext → HLS chunked HTTP PUT |
| `Set-StreamPause.ps1` | dashboard로 pause/resume/consent API 호출 |
| `install.ps1` | 운영자용 1회 설치 (Task Scheduler 등록, ffmpeg 자동 다운로드) |
| `uninstall.ps1` | 제거 (스케줄러/파일/설정 모두 삭제) |
| `setup.iss` | Inno Setup 패키저 (배포용 setup.exe 생성) |

## 의존성

- Windows 10/11 (PowerShell 5.1 이상)
- `ffmpeg.exe` — `install.ps1 -DownloadFfmpeg`로 자동 다운로드 (gyan.dev essentials)

## 동작 흐름

```
[운영자]    dashboard → 디바이스 등록 → 스트림 발급 (streamId/streamKey/ingestSecret)
   ↓
[운영자]    Inno Setup으로 위 값들을 박은 setup.exe 빌드
   ↓
[클라이언트] setup.exe 실행 (관리자 권한 동의)
   ↓
[클라이언트] 다음 로그인 시 동의 다이얼로그 자동 표시
   ↓ (동의 시) POST /api/streams/{id}/consent
   ↓
[클라이언트] 트레이 + 항상위 REC 인디케이터 + ffmpeg 시작
   ↓
[ffmpeg]    desktop 캡처 → drawtext 워터마크 → HLS PUT → dashboard
   ↓                                                    https://admin/api/streams/ingest/{key}/seg_NNN.ts
   ↓                                                    https://admin/api/streams/ingest/{key}/index.m3u8
   ↓
[관리자]    /devices/{id}/live → HLS.js 재생 (단명 HMAC 토큰)
[관리자]    /devices/{id}/recordings → 보존된 .ts 세그먼트 목록
```

## ffmpeg 캡처 명령 (요약)

```text
ffmpeg
  -f gdigrab -framerate 10 -i desktop
  -vf "drawtext=text='%WATERMARK%':x=W-tw-20:y=20:fontsize=24:fontcolor=red@0.9:box=1:boxcolor=black@0.4"
  -c:v libx264 -preset veryfast -tune zerolatency -g 20 -keyint_min 20
  -b:v 1500k -maxrate 1500k -bufsize 3000k -pix_fmt yuv420p
  -f hls
    -method PUT
    -http_persistent 1
    -headers "Authorization: Bearer <ingestSecret>\r\n"
    -hls_time 2 -hls_list_size 6
    -hls_flags delete_segments+independent_segments+omit_endlist
    -hls_segment_filename "https://admin/.../seg_%05d.ts"
    "https://admin/.../index.m3u8"
```

`drawtext`로 송출/녹화 스트림 모두에 워터마크가 박힙니다. **클라이언트가 아무리 트레이를 닫아도
저장되는 영상에는 항상 REC 워터마크가 남습니다** (이게 핵심 안전장치).
