"use client";

import { useState } from "react";
import TrackA from "./track-a";
import TrackB from "./track-b";

export default function EntryPage() {
  const [track, setTrack] = useState<"A" | "B">("A");

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h2 className="text-xl font-bold text-gray-900">순찰 입력</h2>

      {/* Track 탭 */}
      <div className="flex bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setTrack("A")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors
            ${track === "A" ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"}`}
        >
          실시간
        </button>
        <button
          onClick={() => setTrack("B")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors
            ${track === "B" ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"}`}
        >
          일괄 업로드
        </button>
      </div>

      {track === "A" ? <TrackA /> : <TrackB />}
    </div>
  );
}
