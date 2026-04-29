# Streaming Agent (Windows)

이 폴더는 **합법적인 사내/개인 디바이스 모니터링** 용도의 Windows 스트리밍 agent입니다.
무단 설치, 은닉 실행, 비동의 모니터링은 금지하며, 다음 4가지 안전장치를 코드 수준에서 보장합니다.

## 코드로 보장하는 안전선 4가지

1. **명시적 동의 다이얼로그** — `Show-ConsentDialog.ps1`이 첫 실행 시 사용자 입력을 받아야만 ACTIVE 전환.
2. **항상 표시되는 REC 인디케이터** — 시스템 트레이 빨간 점 + 화면 우상단 항상 위 떠있는 작은 워터마크 창. 사용자 임의 종료 가능.
3. **OS 권한 다이얼로그 정상 통과** — 사용자에게 카메라/마이크 권한이 아닌 화면 캡처임을 명시. 보안 SW 우회 절대 금지.
4. **사용자 일시정지/철회 권한** — 트레이 메뉴에서 즉시 일시정지 또는 동의 철회. 관리자는 이를 강제로 재개할 수 없음.

## 구성

| 파일 | 역할 |
|---|---|
| `agent-config.example.json` | `streamId`, `ingestSecret`, `dashboardBase`, `mediamtxRtmp` 등 |
| `Start-StreamAgent.ps1` | 메인 엔트리. 트레이 + 항상위 REC + ffmpeg 슈퍼바이저 |
| `Show-ConsentDialog.ps1` | 첫 실행 시 사용자 동의 다이얼로그 |
| `Invoke-Capture.ps1` | ffmpeg gdigrab → drawtext → RTMP push 명령 빌더/실행 |
| `Set-StreamPause.ps1` | dashboard로 pause/resume API 호출 |
| `install.ps1` | 운영자용 1회 설치 (Task Scheduler 등록, ffmpeg 자동 다운로드) |
| `uninstall.ps1` | 제거 (스케줄러/파일/설정 모두 삭제) |

## 의존성

- Windows 10/11 (PowerShell 5.1 이상 또는 PowerShell 7)
- `ffmpeg.exe` (자동 다운로드 또는 수동 배치) — `gyan.dev` 의 essentials 빌드 권장

## 동작 흐름

```
[설치] install.ps1
   ↓
[등록] dashboard에서 디바이스 별로 스트림 등록 → streamId/ingestSecret 발급
   ↓
[배포] agent-config.json 작성하여 클라이언트에 배치
   ↓
[첫 실행] Start-StreamAgent.ps1
   ├─ Show-ConsentDialog → 사용자 동의 시 POST /api/streams/{id}/consent
   ├─ 트레이 아이콘 + 항상위 REC 창 표시
   └─ Invoke-Capture (ffmpeg) RTMP push 시작
   ↓
[운영] 사용자가 트레이 메뉴에서 일시정지/재개/철회 가능
[감사] 모든 이벤트가 dashboard audit log에 기록
```

## ffmpeg 캡처 명령 (요약)

```text
ffmpeg
  -f gdigrab -framerate 10 -i desktop
  -vf "drawtext=text='%WATERMARK%':x=W-tw-20:y=20:fontsize=24:fontcolor=red@0.9:box=1:boxcolor=black@0.4"
  -c:v libx264 -preset veryfast -tune zerolatency -g 20 -keyint_min 20
  -b:v 1500k -maxrate 1500k -bufsize 3000k
  -pix_fmt yuv420p
  -f flv "rtmp://<host>:1935/<streamKey>?secret=<ingestSecret>"
```

`drawtext`로 송출/녹화 스트림 모두에 워터마크가 박힙니다. **클라이언트가 아무리 트레이를 닫아도
저장되는 영상에는 항상 REC 워터마크가 남습니다** (이게 핵심 안전장치).
