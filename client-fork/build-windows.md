# RustDesk Windows 클라이언트 포크/빌드 가이드

이 문서는 합법적인 사내/개인 디바이스 원격지원 운영 목적만 다룹니다.  
무단 설치, 은닉 실행, 감시 기능, 백도어 구현은 금지합니다.

## 1) 공식 저장소 포크

1. RustDesk 공식 저장소를 GitHub에서 fork
2. 로컬 클론
3. 운영 브랜치 생성

```bash
git clone https://github.com/<your-org>/rustdesk.git
cd rustdesk
git remote add upstream https://github.com/rustdesk/rustdesk.git
git checkout -b feat/selfhost-branding
```

## 2) Windows 빌드 환경 준비

- Visual Studio Build Tools (MSVC)
- vcpkg
- Flutter SDK (stable)
- Rust toolchain (stable)

권장:
- x64 Native Tools Prompt 사용
- `flutter doctor`로 의존성 점검

## 3) custom.txt 포함 방식

`client-fork/custom.txt` 내용을 빌드 입력으로 포함합니다.

```txt
rendezvous-server=${RUSTDESK_DOMAIN}
api-server=https://${RUSTDESK_DOMAIN}:21114
key=<hbbs-public-key>
```

주의:
- `<hbbs-public-key>`는 서버에서 발급된 실제 공개키 사용
- 배포 환경마다 `RUSTDESK_DOMAIN` 값 분리

## 4) 서버 주소 하드코딩 주의사항

- 허용 범위: 공식 RustDesk 구조 내 서버 주소 기본값/브랜딩 변경
- 비허용: 은닉형 재접속 로직, 임의 백그라운드 자동 설치, 사용자 동의 없는 권한 상승

## 5) 아이콘/앱 이름 변경 위치

- 앱 표시 이름: Flutter/플랫폼별 리소스 설정
- 아이콘: Windows 리소스(.ico) 및 Flutter assets 경로
- 변경 시 원본 라이선스 및 고지 의무 준수

## 6) 설치파일 생성 흐름

### 방법 A: Inno Setup
1. 빌드 산출물 수집
2. Inno Setup 스크립트 작성
3. 서명/버전 정보 반영 후 `setup.exe` 생성

이 저장소에는 원클릭 배포용 기본 스크립트를 포함합니다.

- `installer/setup.iss`
- `installer/configure-custom.ps1`
- `installer/add-firewall-rules.ps1`
- `installer/router-portforward-guide.md`

#### 구현된 동작

- 설치 시 관리자 권한 요청 (`PrivilegesRequired=admin`)
- 설치 단계에서 `custom.txt` 자동 생성
  - `rendezvous-server`, `relay-server`, `key` 자동 반영
- 설치 단계에서 Windows 방화벽 규칙 자동 등록
  - 대상 exe 기준 Inbound TCP/UDP 허용
- 설치 완료 메시지로 공유기 포트포워딩 안내 링크 제공

#### Inno Setup 빌드 예시

`installer/setup.iss`는 아래 파라미터를 받아 환경별 패키징이 가능합니다.

```powershell
iscc .\installer\setup.iss `
  /DServerDomain=housingnewshub.info `
  /DServerRelay=housingnewshub.info:21117 `
  /DServerPubKey=YOUR_HBBS_PUBLIC_KEY
```

현재 저장소 기본값은 이미 아래로 고정되어 있어, 파라미터 없이도 즉시 빌드 가능합니다.

- `ServerDomain=housingnewshub.info`
- `ServerRelay=housingnewshub.info:21117`
- `ServerPubKey=0u96kmcWNHhHqeVeZk8MhQG7iiAhQzRlJ8cpmu7GzFI=`

```powershell
iscc .\installer\setup.iss
```

#### 산출물 배치 규칙

- RustDesk 빌드 산출 exe를 `client-fork/dist/rustdesk.exe`로 복사
- 이후 `iscc installer/setup.iss` 실행 시 설치 파일 생성

#### 주의

- 방화벽 규칙 자동 등록은 로컬 OS 범위입니다.
- 공유기 포트포워딩은 자동화하지 않고 안내 링크로 유도합니다(보안/관리 권한 이슈).

### 방법 B: flutter_distributor
1. `flutter_distributor` 설정 파일 작성
2. 채널/아키텍처 지정
3. MSI/EXE 패키지 생성

## 7) 금지사항 재확인

- 무단 설치
- 은닉 실행
- 키로깅/화면 감시 목적 기능
- 사용자 동의 없는 영구 실행 등록

운영 정책과 법률, 조직 보안 규정을 준수하세요.
