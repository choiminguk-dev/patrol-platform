"use client";

import { useState, useEffect } from "react";

interface Complaint {
  id: string;
  title: string;
  address: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

interface User {
  id: string;
  name: string;
  role: string;
}

export default function ComplaintsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadComplaints();
    fetch("/api/auth/users").then((r) => r.json()).then(setUsers);
  }, []);

  async function loadComplaints() {
    const res = await fetch("/api/complaints");
    if (res.ok) setComplaints(await res.json());
  }

  async function handleCreate() {
    if (!title) return;
    setSubmitting(true);
    await fetch("/api/complaints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, address: address || undefined, assignedTo: assignedTo || undefined }),
    });
    setTitle(""); setAddress(""); setAssignedTo(""); setShowForm(false);
    loadComplaints();
    setSubmitting(false);
  }

  async function updateStatus(id: string, status: string) {
    await fetch("/api/complaints", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    loadComplaints();
  }

  const pending = complaints.filter((c) => c.status === "pending");
  const assigned = complaints.filter((c) => c.status === "assigned");
  const done = complaints.filter((c) => c.status === "done");

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">민원 관리</h2>
        <button onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold">
          + 민원 등록
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="민원 제목" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="주소/위치" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">담당자 배정 (선택)</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
            ))}
          </select>
          <button onClick={handleCreate} disabled={submitting || !title}
            className="w-full py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">
            {submitting ? "등록 중..." : "등록"}
          </button>
        </div>
      )}

      {/* 대기 */}
      <Section title="대기" count={pending.length} color="amber">
        {pending.map((c) => (
          <ComplaintCard key={c.id} c={c}
            onAssign={() => updateStatus(c.id, "assigned")}
            onDone={() => updateStatus(c.id, "done")} />
        ))}
      </Section>

      {/* 배정 */}
      <Section title="배정됨" count={assigned.length} color="blue">
        {assigned.map((c) => (
          <ComplaintCard key={c.id} c={c}
            onDone={() => updateStatus(c.id, "done")} />
        ))}
      </Section>

      {/* 완료 */}
      <Section title="완료" count={done.length} color="emerald">
        {done.map((c) => (
          <ComplaintCard key={c.id} c={c} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, count, color, children }: {
  title: string; count: number; color: string; children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        {title} <span className={`text-${color}-600`}>({count})</span>
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ComplaintCard({ c, onAssign, onDone }: {
  c: Complaint; onAssign?: () => void; onDone?: () => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-3 py-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{c.title}</p>
          {c.address && <p className="text-xs text-gray-500">{c.address}</p>}
          <p className="text-xs text-gray-400">
            {c.assigneeName && `${c.assigneeName} · `}
            {c.createdAt?.slice(0, 10)}
          </p>
        </div>
        <div className="flex gap-1.5">
          {onAssign && (
            <button onClick={onAssign} className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-600">배정</button>
          )}
          {onDone && (
            <button onClick={onDone} className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-600">완료</button>
          )}
        </div>
      </div>
    </div>
  );
}
