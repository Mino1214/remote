# 공유기 포트포워딩 안내

설치 프로그램은 **Windows 방화벽 규칙**까지 자동으로 등록합니다.  
하지만 공유기 포트포워딩은 네트워크 장비 관리자 권한이 필요하므로 수동 설정이 필요합니다.

## 필요한 포트

- `21115/tcp`
- `21116/tcp`
- `21116/udp`
- `21117/tcp` (relay)
- `21118/tcp`

## 빠른 가이드 링크

- 공유기 모델별 포트포워딩: https://portforward.com/router.htm
- 일반 포트포워딩 가이드: https://portforward.com/how-to-port-forward/

## 팁

- 내부 IP는 RustDesk 서버가 실행 중인 PC의 고정 IP 사용
- 공유기 재부팅 후 외부망에서 연결 테스트
- 방화벽/보안SW에서 위 포트 차단 여부 확인
