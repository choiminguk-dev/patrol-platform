// 환경순찰 카테고리 체계 (19종) → 평가항목 매핑

export interface Category {
  id: string;
  label: string;
  eval: string;      // 평가항목: 과태료, 경고판, 상습지역, 현장평가, 분리배출, 특수사업, 홍보, 별도
  points: number;     // 배점
  unit: string;       // 건, 개소, kg, 매, 회
}

export const CATEGORIES: Category[] = [
  { id: 'illegal_dump', label: '무단투기 민원', eval: '과태료', points: 30, unit: '건' },
  { id: 'warning_post', label: '경고장 부착', eval: '과태료', points: 30, unit: '건' },
  { id: 'night_patrol', label: '야간 단속', eval: '과태료', points: 30, unit: '건' },
  { id: 'complaint_done', label: '민원 조치완료', eval: '과태료', points: 30, unit: '건' },
  { id: 'warning_sign', label: '스마트경고판', eval: '경고판', points: 5, unit: '건' },
  { id: 'patrol_check', label: '상습지역 순찰', eval: '상습지역', points: 10, unit: '개소' },
  { id: 'special_mgmt', label: '특별관리구역', eval: '상습지역', points: 10, unit: '개소' },
  { id: 'road_clean', label: '이면도로 청소', eval: '현장평가', points: 0.5, unit: '건' },
  { id: 'road_mgmt', label: '도로(관리)', eval: '별도', points: 0, unit: '건' },
  { id: 'alley_clean', label: '골목 청소완료', eval: '현장평가', points: 0.5, unit: '건' },
  { id: 'battery_cert', label: '폐건전지', eval: '분리배출', points: 15, unit: 'kg' },
  { id: 'appliance_cert', label: '폐소형가전', eval: '분리배출', points: 15, unit: 'kg' },
  { id: 'pet_bottle', label: '투명페트병', eval: '분리배출', points: 15, unit: '매' },
  { id: 'special_project', label: '특수사업', eval: '특수사업', points: 10, unit: '회' },
  { id: 'promotion', label: '홍보활동', eval: '홍보', points: 10, unit: '건' },
  { id: 'recycle_promo', label: '분리배출 홍보', eval: '홍보', points: 10, unit: '건' },
  { id: 'safety_check', label: '안전점검', eval: '별도', points: 0, unit: '건' },
  { id: 'building_check', label: '위험건축물', eval: '별도', points: 0, unit: '건' },
  { id: 'flood_control', label: '치수(수방)', eval: '별도', points: 0, unit: '건' },
  { id: 'greenery', label: '녹지(수목)', eval: '별도', points: 0, unit: '건' },
  { id: 'streetlight', label: '가로등', eval: '별도', points: 0, unit: '건' },
  { id: 'snow_removal', label: '제설', eval: '별도', points: 0, unit: '건' },
  { id: 'etc', label: '기타', eval: '별도', points: 0, unit: '건' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

// 풀별 기본 카테고리
export const POOL_DEFAULTS: Record<string, string> = {
  PUB: 'road_clean',
  KEEP: 'alley_clean',
  RES: 'recycle_promo',
};

// 평가 목표 (반기 기준, 100점 만점)
export const EVAL_TARGETS = {
  '과태료': { maxPoints: 30, target: 30, label: '무단투기 과태료', unit: '건' },
  '경고판': { maxPoints: 5, target: 10, label: '스마트경고판', unit: '건' },
  '상습지역': { maxPoints: 10, target: 10, label: '상습지역 관리', unit: '개소' },
  '현장평가': { maxPoints: 20, target: 40, label: '이면도로 현장평가 (0.5점/건)', unit: '건' },
  '분리배출': { maxPoints: 15, target: 0, label: '분리배출 활성화', unit: '' },
  '특수사업': { maxPoints: 10, target: 5, label: '특수사업', unit: '회' },
  '홍보': { maxPoints: 10, target: 6, label: '홍보 실적', unit: '건' },
};
