import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-emerald-50 flex flex-col">
      {/* 헤더 */}
      <header className="bg-emerald-700 text-white py-4 px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold">환경순찰 AI</h1>
          <Link href="/login" className="text-sm bg-white/20 px-3 py-1 rounded-lg hover:bg-white/30">
            로그인
          </Link>
        </div>
      </header>

      {/* 히어로 */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="max-w-2xl text-center space-y-6">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
            사진만 올리면<br />순찰일지가 자동으로
          </h2>
          <p className="text-lg text-gray-600">
            AI가 주소판을 인식하고, 사진을 분류하고,<br />
            순찰일지까지 자동 생성합니다.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
            <FeatureCard
              title="주소판 OCR"
              desc="도로명 표지판을 자동 인식하여 위치 정보를 추출합니다"
            />
            <FeatureCard
              title="사진 자동 그룹핑"
              desc="주소판 + 현장사진 패턴을 파악하여 자동 분류합니다"
            />
            <FeatureCard
              title="순찰일지 생성"
              desc="수집된 데이터를 기반으로 일지를 자동 작성합니다"
            />
          </div>

          <div className="pt-6 space-y-3">
            <Link href="/login"
              className="inline-block px-8 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors">
              시작하기
            </Link>
            <p className="text-xs text-gray-400">
              CSAP 인증 국내 클라우드 배포 · HTTPS 암호화 · MIT 라이선스
            </p>
          </div>
        </div>
      </main>

      {/* 푸터 */}
      <footer className="bg-emerald-800 text-emerald-300 text-xs py-4 px-6 text-center">
        후암동 환경순찰 통합 관리 시스템 · 적극행정 추진
      </footer>
    </div>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-white rounded-xl p-4 text-left shadow-sm">
      <h3 className="font-bold text-emerald-700 mb-1">{title}</h3>
      <p className="text-sm text-gray-500">{desc}</p>
    </div>
  );
}
