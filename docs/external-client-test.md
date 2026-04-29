# 외부망 RustDesk 클라이언트 연결 테스트 런북

이 문서는 합법적인 사내/개인 디바이스 원격지원 운영 목적의 외부망(다른 공유기) 클라이언트
연결 검증 절차만 다룹니다.

## 0) 사전 정보

| 항목 | 값 |
|---|---|
| 임시 서버 호스트 | `housingnewshub.info` (= 공인 IP `124.55.10.198`) |
| LAN IP | `192.168.219.112` |
| ID/Rendezvous 서버 | `housingnewshub.info` |
| Relay 서버 | `housingnewshub.info:21117` |
| API 서버 | (현재 외부 미노출, 비워둠) |
| 공개키 (`id_ed25519.pub`) | `0u96kmcWNHhHqeVeZk8MhQG7iiAhQzRlJ8cpmu7GzFI=` |
| Dashboard 호스트 포트 | `3010` (3000은 다른 PM2 서비스가 사용 중) |

> 키는 서버에서 자동 생성되는 값입니다. `docker run --rm -v docker_hbbs_data:/data alpine cat /data/id_ed25519.pub` 로 항상 재확인 가능합니다.

## 1) 서버 측 (이 PC, macOS) — 완료 상태 확인

```bash
docker ps | grep -E "hbbs|hbbr|dashboard|rustdesk-api|postgres"
curl -sI http://127.0.0.1:3010/login | head -1   # 200 이어야 OK
pgrep -lf "cloudflared.*housingnewshub"           # 1개 PID 떠야 정상
```

기대치:
- `docker-hbbs-1`, `docker-hbbr-1`, `docker-dashboard-1`, `docker-rustdesk-api-1`, `docker-postgres-1` 모두 healthy/running
- `httpd HTTP/1.1 200 OK`
- cloudflared `housingnewshub-tunnel`(PM2) 프로세스 1개

## 2) DNS 설정 (Cloudflare 대시보드)

RustDesk hbbs/hbbr는 raw TCP/UDP라 Cloudflare 프록시 통과 불가. 따라서 **별도 호스트네임을
프록시 OFF(회색 구름)로 공인 IP에 연결**해야 합니다.

| 호스트네임 | 타입 | 값 | Proxy |
|---|---|---|---|
| `housingnewshub.info` | CNAME | `10dda781-c1fb-4144-9504-c176a5c4640d.cfargotunnel.com` | ON (대시보드용) |
| `admin.housingnewshub.info` | CNAME | 위와 동일 | ON (대시보드용) |
| `rd.housingnewshub.info` | CNAME | 위와 동일 | ON (hbbs HTTP API) |
| `relay.housingnewshub.info` | A | `124.55.10.198` (공인 IP) | **OFF (회색)** |

클라이언트의 `rendezvous-server`/`relay-server`로는 **`relay.housingnewshub.info`** 를 사용
하는 것을 권장합니다 (CDN/프록시 영향 없음).

## 3) 공유기 포트포워딩 (필수)

공유기 관리자 페이지 → 포트포워드 메뉴에서 다음을 추가:

| 외부 포트 | 프로토콜 | 내부 IP | 내부 포트 |
|---|---|---|---|
| 21115 | TCP | 192.168.219.112 | 21115 |
| 21116 | TCP | 192.168.219.112 | 21116 |
| 21116 | UDP | 192.168.219.112 | 21116 |
| 21117 | TCP | 192.168.219.112 | 21117 |
| 21118 | TCP | 192.168.219.112 | 21118 |

> 21118은 hbbs 웹/API 직접 접근용. Cloudflare Tunnel(`rd.housingnewshub.info`)로도 접근 가능
> 하므로 외부 직접 노출이 필수는 아닙니다. 단, 클라이언트가 `rd.housingnewshub.info` 미사용 시
> 21118도 포워딩하는 게 단순.

서버(이 Mac)의 macOS 방화벽에서 들어오는 연결 허용도 확인 필요 (System Settings → Network →
Firewall → 비활성 또는 docker 컨테이너 허용).

검증:
```bash
# 외부망 PC에서
nc -zv 124.55.10.198 21115     # succeeded 떠야 함
nc -zvu 124.55.10.198 21116    # UDP
nc -zv  124.55.10.198 21117
```

## 4) Windows 클라이언트 설치 (포크 빌드 안 쓰는 경로)

1. https://github.com/rustdesk/rustdesk/releases 에서 최신 `rustdesk-x.x.x-x86_64.exe` 다운로드
2. 실행 → 좌하단 톱니(⚙) → **Network**
3. 다음 4개 값 입력 후 **Apply**:

```text
ID Server   : relay.housingnewshub.info
Relay Server: relay.housingnewshub.info:21117
API Server  : (비워둠)
Key         : 0u96kmcWNHhHqeVeZk8MhQG7iiAhQzRlJ8cpmu7GzFI=
```

4. 메인 화면 좌상단의 **9자리 ID**와 **임시 비밀번호** 메모

## 5) Mac 제어기에서 접속 (이 PC가 controller, Win이 controlled 시나리오)

1. RustDesk Mac 앱 실행 → ⚙ → Network → Win과 동일한 4개 값 입력
2. 메인 화면 좌측 입력란에 Win에서 본 9자리 ID 입력 → Connect
3. 비밀번호 프롬프트에 Win 임시 비번 입력
4. Win 화면이 떠야 성공. 마우스/키보드 입력이 그대로 전달되는지 확인

## 6) 트러블슈팅

- ID 옆에 빨간 점 / `Disconnected`
  - DNS A레코드 `relay.housingnewshub.info` 가 공인 IP를 가리키는지 (Proxy OFF 필수)
  - `nc -zv` 로 21115/21117 도달 가능 여부 확인 → 안 되면 공유기 포트포워딩 또는 ISP 차단
- "Key mismatch"
  - 서버 재배포 후 키가 바뀌었을 가능성. `docker run --rm -v docker_hbbs_data:/data alpine cat /data/id_ed25519.pub` 재확인 후 양쪽 클라에 동일 키 재입력
- 화면은 뜨는데 입력만 안 먹힘 (Mac controller)
  - 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용/입력 모니터링/화면 기록에 RustDesk 추가
- 외부망에서만 안 되고 LAN은 됨
  - 공유기에서 NAT loopback 미지원이라 같은 공유기 안에서는 공인 IP/도메인이 안 풀릴 수 있음.
    LAN 내부에서는 `192.168.219.112`로 직접 접속

## 7) 보안 체크리스트 (테스트 후)

- [ ] 관리자 초기 비밀번호 변경 (`/login`에서)
- [ ] `DASHBOARD_IP_ALLOWLIST`에 운영 IP만 등록
- [ ] `housingnewshub.info`/`admin.housingnewshub.info` 에 Cloudflare Access 정책 적용
- [ ] 21115-21118 포트포워딩 범위가 RustDesk 외 다른 트래픽에 노출되지 않는지 점검
- [ ] 임시 테스트 종료 후 공유기 포트포워딩 비활성화 또는 IP 화이트리스트
