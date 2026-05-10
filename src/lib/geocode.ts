/**
 * GPS 좌표 → 주소 역지오코딩
 * 우선순위: Kakao Map API (한국 도로명+건물번호 정확) → Nominatim 폴백
 * Kakao 사용 시 환경변수 KAKAO_REST_API_KEY 필요
 */

interface NominatimResponse {
  display_name?: string;
  address?: {
    road?: string;
    house_number?: string;
    neighbourhood?: string;
    suburb?: string;
    quarter?: string;
    city_district?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

interface KakaoCoord2Address {
  documents?: Array<{
    address?: {
      address_name?: string;
      region_3depth_name?: string; // 동
      main_address_no?: string;    // 본 지번
      sub_address_no?: string;     // 부 지번
    };
    road_address?: {
      address_name?: string;
      road_name?: string;
      main_building_no?: string;
      sub_building_no?: string;
    };
  }>;
}

interface KakaoAddressSearch {
  documents?: Array<{
    x?: string;
    y?: string;
    road_address?: {
      address_name?: string;
      road_name?: string;
      main_building_no?: string;
      sub_building_no?: string;
      x?: string;
      y?: string;
    };
    address?: {
      x?: string;
      y?: string;
    };
  }>;
}

async function kakaoFetch<T>(url: string, key: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** 좌표→도로명 단일 시도 */
async function tryCoord2Road(
  lat: number,
  lng: number,
  key: string
): Promise<{ dong: string | null; road: string | null; jibun: string | null; main_no?: string; sub_no?: string }> {
  const data = await kakaoFetch<KakaoCoord2Address>(
    `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`,
    key
  );
  const doc = data?.documents?.[0];
  if (!doc) return { dong: null, road: null, jibun: null };

  const dong = doc.address?.region_3depth_name || null;
  const ra = doc.road_address;
  let road: string | null = null;
  if (ra?.road_name) {
    const num = ra.sub_building_no
      ? `${ra.main_building_no}-${ra.sub_building_no}`
      : ra.main_building_no || "";
    road = num ? `${ra.road_name} ${num}` : ra.road_name;
  }
  return {
    dong,
    road,
    jibun: doc.address?.address_name || null,
    main_no: doc.address?.main_address_no,
    sub_no: doc.address?.sub_address_no,
  };
}

/** Kakao Map API 역지오코딩 (8방향 그리드 탐색으로 도로명 정확도 극대화) */
async function kakaoReverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) {
    console.log("[geocode] KAKAO_REST_API_KEY 미설정");
    return null;
  }

  // 5m + 10m 2단계 그리드 (총 17점)
  // 1도 ≈ 위도 111km, 경도 88km → 0.00005 ≈ 5m, 0.0001 ≈ 10m
  const D1 = 0.00005; // 5m
  const D2 = 0.0001;  // 10m
  const points: [number, number, number][] = [
    [lat, lng, 0],                            // 중심 (최우선)
    // 5m 4방향 (가까운 우선)
    [lat + D1, lng, 0.5],                     // N5
    [lat - D1, lng, 0.5],                     // S5
    [lat, lng + D1, 0.5],                     // E5
    [lat, lng - D1, 0.5],                     // W5
    // 5m 대각선
    [lat + D1, lng + D1, 0.7],                // NE5
    [lat + D1, lng - D1, 0.7],                // NW5
    [lat - D1, lng + D1, 0.7],                // SE5
    [lat - D1, lng - D1, 0.7],                // SW5
    // 10m 4방향
    [lat + D2, lng, 1.0],                     // N10
    [lat - D2, lng, 1.0],                     // S10
    [lat, lng + D2, 1.0],                     // E10
    [lat, lng - D2, 1.0],                     // W10
    // 10m 대각선
    [lat + D2, lng + D2, 1.4],                // NE10
    [lat + D2, lng - D2, 1.4],                // NW10
    [lat - D2, lng + D2, 1.4],                // SE10
    [lat - D2, lng - D2, 1.4],                // SW10
  ];

  // 병렬로 9개 좌표 시도
  const results = await Promise.all(
    points.map(async ([la, ln, dist]) => ({
      ...(await tryCoord2Road(la, ln, key)),
      dist,
    }))
  );

  // 도로명 있는 결과 중 거리 가장 가까운 것 선택
  const withRoad = results.filter((r) => r.road).sort((a, b) => a.dist - b.dist);
  if (withRoad.length > 0) {
    const best = withRoad[0];
    const result = best.dong ? `${best.dong} (${best.road})` : best.road!;
    console.log(`[geocode] kakao 도로명 OK (${best.dist === 0 ? "중심" : `${best.dist}D`}):`, result);
    return result;
  }

  // 도로명 못 찾으면 중심점의 지번 → 지번으로 도로명 재검색 시도
  const center = results[0];
  if (center.jibun) {
    const search = await kakaoFetch<KakaoAddressSearch>(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(center.jibun)}`,
      key
    );
    const sd = search?.documents?.[0];
    if (sd?.road_address?.road_name) {
      const num = sd.road_address.sub_building_no
        ? `${sd.road_address.main_building_no}-${sd.road_address.sub_building_no}`
        : sd.road_address.main_building_no || "";
      const road = num ? `${sd.road_address.road_name} ${num}` : sd.road_address.road_name;
      console.log("[geocode] kakao 지번→도로명 변환 OK:", `${center.dong} (${road})`);
      return center.dong ? `${center.dong} (${road})` : road;
    }
  }

  // 최후 폴백: 동 + 지번
  if (center.dong && center.main_no) {
    const subNo = center.sub_no && center.sub_no !== "0" ? `-${center.sub_no}` : "";
    const result = `${center.dong} ${center.main_no}${subNo}`;
    console.log("[geocode] kakao 지번 폴백 (도로명 매핑 없음):", result);
    return result;
  }
  if (center.dong) {
    console.log("[geocode] kakao 동만:", center.dong);
    return center.dong;
  }
  return center.jibun;
}

/**
 * 위도/경도 → 한국 주소 (동 + 도로명 형식)
 * 예: "후암동 (후암로 32-6)", "후암동 (두텁바위로)"
 *     도로명 없으면 "후암동", 동 없으면 "후암로 32-6"
 *
 * 우선: Kakao Map API → 폴백: Nominatim
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string | null> {
  // 1) Kakao 우선 시도 (한국 도로명+건물번호 정확)
  const kakao = await kakaoReverseGeocode(lat, lng);
  if (kakao) return kakao;

  // 2) Nominatim 폴백
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ko&zoom=18`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "patrol-platform/1.0 (https://patrol.ai.kr)",
      },
      // 5초 타임아웃
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as NominatimResponse;
    const addr = data.address;
    if (!addr) return null;

    // 동 (행정동/법정동)
    const dong =
      addr.quarter || addr.neighbourhood || addr.suburb || addr.city_district;

    // 도로명 + 건물번호
    let road: string | null = null;
    if (addr.road) {
      road = addr.house_number ? `${addr.road} ${addr.house_number}` : addr.road;
    }

    // 동(도로명) 형식
    if (dong && road) return `${dong} (${road})`;
    if (dong) return dong;
    if (road) return road;

    // 폴백: display_name 첫 부분
    if (data.display_name) {
      return data.display_name.split(",")[0].trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 주소 → 좌표 (forward geocoding)
 * 예: "후암로 32-6" → { lat: 37.5505, lng: 126.9759 }
 * Kakao 우선, 실패 시 null
 */
export async function forwardGeocode(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  if (!address?.trim()) return null;
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return null;

  try {
    const data = await kakaoFetch<KakaoAddressSearch>(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
      key
    );
    const doc = data?.documents?.[0];
    if (!doc) return null;

    // road_address 우선, 없으면 address(지번)
    const xStr = doc.road_address?.x || doc.address?.x || doc.x;
    const yStr = doc.road_address?.y || doc.address?.y || doc.y;
    if (!xStr || !yStr) return null;

    const lng = parseFloat(xStr);
    const lat = parseFloat(yStr);
    if (isNaN(lat) || isNaN(lng)) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}
