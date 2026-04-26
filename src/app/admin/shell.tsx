"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
interface ShellProps {
  user: { id: string; name: string; role: string; pool: string | null };
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/admin", label: "홈", icon: HomeIcon },
  { href: "/admin/dashboard", label: "현황", icon: ChartIcon },
  { href: "/admin/docs", label: "보고서", icon: DocIcon },
  { href: "/admin/zones", label: "구역", icon: ZoneIcon, adminOnly: true },
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "담당자",
  SAFETY: "안전담당",
  DRIVER: "운전직",
  CHIEF: "동장",
  PUBLIC_WORKER: "공무관",
  KEEPER: "지킴이",
  RESOURCE: "자원관리사",
};

export function AdminShell({ user, children }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-dvh bg-gray-50">
      {/* 데스크톱 사이드바 */}
      <aside className="hidden md:flex md:w-60 flex-col bg-emerald-800 text-white">
        <div className="p-4 border-b border-emerald-700">
          <h1 className="text-lg font-bold">환경순찰</h1>
          <p className="text-emerald-300 text-xs mt-0.5">후암동</p>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.filter((i) => !i.adminOnly || user.role === "ADMIN").map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors
                  ${active ? "bg-emerald-700 text-white font-semibold" : "text-emerald-200 hover:bg-emerald-700/50"}`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-emerald-700">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-sm font-bold">
              {user.name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-emerald-300">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full text-xs text-emerald-300 hover:text-white py-1 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 모바일 헤더 */}
        <header className="md:hidden flex items-center justify-between px-4 h-12 bg-emerald-700 text-white">
          <h1 className="text-sm font-bold">환경순찰</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-emerald-200">{user.name}</span>
            <button onClick={handleLogout} className="text-xs text-emerald-300">
              로그아웃
            </button>
          </div>
        </header>

        {/* 페이지 콘텐츠 */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {/* 모바일 하단 탭바 */}
        <nav className="md:hidden flex border-t border-gray-200 bg-white">
          {NAV_ITEMS.filter((i) => !i.adminOnly || user.role === "ADMIN").map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex flex-col items-center py-2 text-xs transition-colors
                  ${active ? "text-emerald-600 font-semibold" : "text-gray-400"}`}
              >
                <item.icon className="w-5 h-5 mb-0.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </main>
    </div>
  );
}

// --- 아이콘 ---
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955a1.126 1.126 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  );
}

function ComplaintIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
    </svg>
  );
}

function DocIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function MapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
    </svg>
  );
}

function ZoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  );
}
