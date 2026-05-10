-- 14명 사용자 시드 (기본 PIN: 0000)
-- bcrypt hash of '0000' with 10 rounds
-- 생성: SELECT crypt('0000', gen_salt('bf', 10))

INSERT INTO "users" ("id", "name", "role", "pool", "pinHash", "isActive", "tenantId") VALUES
  ('me',    '청소담당',     'ADMIN',          NULL,   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('safety','안전담당',     'SAFETY',         NULL,   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('driver','운전직',       'DRIVER',         NULL,   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('chief', '동장',         'CHIEF',          NULL,   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('pub1',  '공무관1',      'PUBLIC_WORKER',  'PUB',  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('pub2',  '공무관2',      'PUBLIC_WORKER',  'PUB',  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('pub3',  '공무관3',      'PUBLIC_WORKER',  'PUB',  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('keep1', '지킴이1',      'KEEPER',         'KEEP', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('keep2', '지킴이2',      'KEEPER',         'KEEP', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('keep3', '지킴이3',      'KEEPER',         'KEEP', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('keep4', '지킴이4',      'KEEPER',         'KEEP', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('keep5', '지킴이5',      'KEEPER',         'KEEP', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('res1',  '자원관리사1',  'RESOURCE',       'RES',  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam'),
  ('res2',  '자원관리사2',  'RESOURCE',       'RES',  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, 'huam')
ON CONFLICT ("id") DO NOTHING;
