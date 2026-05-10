import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { reverseGeocode, forwardGeocode } from "@/lib/geocode";

/**
 * 지오코딩 (양방향)
 * - GET ?lat=..&lng=..       → 좌표 to 주소 (reverse)
 * - GET ?address=..          → 주소 to 좌표 (forward)
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  // forward geocoding
  if (address) {
    const coords = await forwardGeocode(address);
    return NextResponse.json({ coords });
  }

  // reverse geocoding
  const lat = parseFloat(searchParams.get("lat") || "");
  const lng = parseFloat(searchParams.get("lng") || "");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "lat/lng 또는 address 필요" }, { status: 400 });
  }

  const addr = await reverseGeocode(lat, lng);
  return NextResponse.json({ address: addr });
}
