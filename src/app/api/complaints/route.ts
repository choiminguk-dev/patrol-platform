import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { queryMany, queryOne, execute } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const complaints = await queryMany(
    `SELECT c.*, u.name as "assigneeName"
     FROM complaints c
     LEFT JOIN users u ON u.id = c."assignedTo"
     ORDER BY c."createdAt" DESC`
  );
  return NextResponse.json(complaints);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { title, address, latitude, longitude, assignedTo } = await request.json();
  if (!title) return NextResponse.json({ error: "제목 필요" }, { status: 400 });

  const id = crypto.randomUUID();
  await execute(
    `INSERT INTO complaints (id, title, address, latitude, longitude, "assignedTo", status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [id, title, address ?? null, latitude ?? null, longitude ?? null, assignedTo ?? null]
  );

  const complaint = await queryOne(`SELECT * FROM complaints WHERE id = $1`, [id]);
  return NextResponse.json(complaint);
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, status, assignedTo } = await request.json();
  if (!id) return NextResponse.json({ error: "ID 필요" }, { status: 400 });

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (status) { sets.push(`status = $${idx++}`); params.push(status); }
  if (assignedTo !== undefined) { sets.push(`"assignedTo" = $${idx++}`); params.push(assignedTo || null); }
  if (status === "done") { sets.push(`"completedAt" = NOW()`); }

  params.push(id);
  await execute(`UPDATE complaints SET ${sets.join(", ")} WHERE id = $${idx}`, params);

  return NextResponse.json({ ok: true });
}
