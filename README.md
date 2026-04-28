# RustDesk Selfhost Monorepo

합법적인 사내/개인 디바이스 원격지원 관리 목적의 RustDesk 셀프호스팅 + 관리 대시보드 프로젝트입니다.  
무단 접속, 은닉 설치, 백도어, 감시 기능은 구현하지 않습니다.

## 프로젝트 구조

```txt
rustdesk-selfhost/
├── docker/
│   ├── docker-compose.yml
│   └── .env.example
├── dashboard/
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── prisma/
│   └── package.json
├── client-fork/
│   ├── custom.txt
│   ├── build-windows.md
│   └── branding/
└── README.md
```

## 실행 방법

1) 환경변수 준비

```bash
cd docker
cp .env.example .env
```

2) 값 수정(필수)
- `JWT_SECRET`, `NEXTAUTH_SECRET`, `RUSTDESK_API_KEY`
- `ADMIN_INITIAL_PASSWORD`, `POSTGRES_PASSWORD`
- `RUSTDESK_DOMAIN`

3) 컨테이너 실행

```bash
docker compose up -d
```

## .env 설정

`docker/.env.example`의 핵심 변수:

```env
RUSTDESK_DOMAIN=rd.example.com
JWT_SECRET=change-me
ADMIN_INITIAL_EMAIL=admin@example.com
ADMIN_INITIAL_PASSWORD=change-me
RUSTDESK_API_KEY=change-me
POSTGRES_USER=rustdesk
POSTGRES_PASSWORD=change-me
POSTGRES_DB=rustdesk_dashboard
DATABASE_URL=postgresql://rustdesk:change-me@postgres:5432/rustdesk_dashboard
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=change-me
RUSTDESK_API_BASE_URL=http://rustdesk-api:21114
```

## Prisma migrate / seed

최초 1회:

```bash
cd ../dashboard
npm install
npx prisma migrate dev --name init
npm run prisma:seed
```

도커 실행 환경에서 배포 마이그레이션:

```bash
npx prisma migrate deploy
```

## 대시보드 접속

- URL: `http://localhost:3000/login`
- 초기 계정: `ADMIN_INITIAL_EMAIL`, `ADMIN_INITIAL_PASSWORD`

## RustDesk 공식 클라이언트 테스트 순서

1. RustDesk 공식 클라이언트 실행
2. ID/Relay 서버를 `RUSTDESK_DOMAIN` 기준으로 설정
3. API 서버를 `https://<RUSTDESK_DOMAIN>:21114`로 설정
4. 대시보드 `/devices`에서 디바이스 목록/메타 확인
5. 디바이스 상세에서 별칭/차단 플래그 수정 확인

## 포트 설명

- `21114`: rustdesk-api
- `21115`: hbbs (NAT type test 등)
- `21116/tcp,udp`: hbbs
- `21117`: hbbr relay (직접 노출 필요 가능)
- `21118`: hbbs web/API
- `21119`: hbbr 추가 포트
- `3000`: dashboard
- `5432`: postgres

## RustDesk API 어댑터 메모

- `dashboard/lib/rustdesk-api.ts`에서 `RUSTDESK_API_BASE_URL`, `RUSTDESK_API_KEY` 사용
- 이미지 구현별 엔드포인트 차이를 고려해 어댑터 구조 사용
- 불확실 엔드포인트는 `TODO` 주석으로 분리
- 개발환경(`NODE_ENV=development`)에서만 mock fallback 허용

## 운영 보안 체크리스트

- 관리자 초기 비밀번호 즉시 변경
- dashboard는 IP allowlist 또는 VPN 뒤에 배치
- rustdesk-api는 외부 직접 노출 금지(역프록시/내부망 권장)
- `21117`(relay) 외부 노출 필요성 검토 후 최소 범위로 허용
- Cloudflare Tunnel / nginx / Let's Encrypt 조합으로 TLS 구성
- 모든 관리자 액션은 `AuditLog` 기록 및 정기 검토
- 서버/이미지 정기 업데이트 및 로그 점검

## 주의

이 프로젝트는 관리/지원 목적입니다.  
사용자 동의 없는 설치, 은닉 동작, 감시/백도어성 기능 추가는 금지합니다.
