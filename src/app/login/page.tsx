"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface UserCard {
  id: string;
  name: string;
  role: string;
  pool: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "청소담당",
  SAFETY: "안전담당",
  DRIVER: "운전직",
  CHIEF: "동장",
  PUBLIC_WORKER: "공무관",
  KEEPER: "지킴이",
  RESOURCE: "자원관리사",
};

// 적극행정용: 청소담당 + 안전담당만 표시
const ALLOWED_IDS = ["me", "safety"];

export default function LoginPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserCard[]>([]);
  const [selected, setSelected] = useState<UserCard | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/users")
      .then((r) => r.json())
      .then((all: UserCard[]) => setUsers(all.filter((u) => ALLOWED_IDS.includes(u.id))));
  }, []);

  async function handleLogin() {
    if (!selected || pin.length !== 4) return;
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selected.id, pin }),
    });

    if (res.ok) {
      router.push("/admin");
      router.refresh();
    } else {
      const data = await res.json();
      setError(data.error || "로그인 실패");
      setPin("");
    }
    setLoading(false);
  }

  // PIN 입력 화면
  if (selected) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-emerald-50 px-4">
        <div className="w-full max-w-sm space-y-6">
          <button
            onClick={() => { setSelected(null); setPin(""); setError(""); }}
            className="text-emerald-600 text-sm flex items-center gap-1"
          >
            ← 다른 사용자 선택
          </button>

          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-full bg-emerald-600 text-white flex items-center justify-center text-2xl font-bold mx-auto">
              {selected.name[0]}
            </div>
            <h2 className="text-xl font-bold text-gray-900">{selected.name}</h2>
            <p className="text-sm text-gray-500">{ROLE_LABELS[selected.role] || selected.role}</p>
          </div>

          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-700 text-center">
              PIN 4자리 입력
            </label>
            <div className="flex justify-center gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-12 h-14 rounded-lg border-2 flex items-center justify-center text-2xl font-bold
                    ${pin.length > i ? "border-emerald-600 bg-emerald-50" : "border-gray-300 bg-white"}`}
                >
                  {pin[i] ? "●" : ""}
                </div>
              ))}
            </div>
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={pin}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                setPin(v);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
              className="sr-only"
              autoFocus
            />
            <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "del"].map((key, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    if (key === "del") setPin((p) => p.slice(0, -1));
                    else if (key !== null && pin.length < 4) setPin((p) => p + key);
                  }}
                  disabled={key === null}
                  className={`h-14 rounded-lg text-xl font-semibold transition-colors
                    ${key === null ? "invisible" : "bg-white border border-gray-200 hover:bg-emerald-50 active:bg-emerald-100"}`}
                >
                  {key === "del" ? "←" : key}
                </button>
              ))}
            </div>

            {error && (
              <p className="text-red-500 text-sm text-center">{error}</p>
            )}

            <button
              onClick={handleLogin}
              disabled={pin.length !== 4 || loading}
              className="w-full py-3 rounded-lg bg-emerald-600 text-white font-semibold
                disabled:opacity-50 hover:bg-emerald-700 transition-colors"
            >
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 사용자 카드 선택 화면
  return (
    <div className="min-h-dvh bg-emerald-50 px-4 py-8">
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-emerald-800">환경순찰</h1>
          <p className="text-sm text-gray-500">사용자를 선택하세요</p>
        </div>

        <div className="space-y-2">
          {users.map((user) => (
            <button
              key={user.id}
              onClick={() => setSelected(user)}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-200
                hover:border-emerald-400 hover:shadow-md transition-all text-left"
            >
              <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0">
                {user.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{user.name}</p>
                <p className="text-xs text-gray-500">{ROLE_LABELS[user.role] || user.role}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
