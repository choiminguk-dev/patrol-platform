# NHN Cloud 배포 완료

> **마지막 업데이트**: 2026-04-05
> **현재 상태**: 배포 완료, 정상 운영 중

---

## 배포 현황

| 항목 | 상태 |
|------|------|
| 도메인 | https://patrol.ai.kr |
| HTTPS | ✅ Caddy + Let's Encrypt 자동 인증서 |
| CSAP | ✅ NHN Cloud (국내 보안 인증) |
| 자동 시작 | ✅ systemd 서비스 등록 |
| DB | NHN RDS PostgreSQL 17.6 |

## 아키텍처

```
[브라우저/모바일]
      ↓ HTTPS (443)
[Caddy — 자동 SSL 인증서]
      ↓ reverse_proxy (3000)
[NHN Instance: Ubuntu 24.04 + Node.js 22]
  Next.js 16 (systemd 자동 시작)
  uploads/ (사진 로컬 저장)
      ↓ TCP (15432)
[NHN RDS: PostgreSQL 17.6]
  patrol-db (6 테이블, 14명 사용자)
```

## 서버 관리

### 코드 업데이트 시

```bash
# SSH 접속
ssh -i C:\Users\user\Downloads\patrol-key.pem ubuntu@133.186.218.27

# 업데이트
cd ~/patrol-platform
git pull origin main
npm run build
sudo systemctl restart patrol
```

### 서비스 관리

```bash
sudo systemctl status patrol    # 상태 확인
sudo systemctl restart patrol   # 재시작
sudo systemctl stop patrol      # 중지
sudo journalctl -u patrol -f    # 로그 확인
```

## 접속 정보

| 항목 | 값 |
|------|-----|
| 웹 | https://patrol.ai.kr |
| 서버 IP | 133.186.218.27 |
| SSH | `ssh -i patrol-key.pem ubuntu@133.186.218.27` |
| DB 호스트 | 9e57d200-...external.kr1.postgres.rds.nhncloudservice.com |
| DB 포트 | 15432 |
| DB 이름 | patrol-db (하이픈 주의) |
| 키페어 | `C:\Users\user\Downloads\patrol-key.pem` |
| PIN | 0000 |

## 비용 (월)

| 항목 | 예상 비용 |
|------|----------|
| Instance (t2.c1m1) | ~18,000원 |
| RDS PostgreSQL (m2.c1m2) | ~33,000원 |
| 도메인 (patrol.ai.kr) | ~1,375원/월 |
| **합계** | **~52,000원/월** |
