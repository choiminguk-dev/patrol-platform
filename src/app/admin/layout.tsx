import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminShell } from "./shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <AdminShell user={{ id: user.id, name: user.name, role: user.role, pool: user.pool }}>
      {children}
    </AdminShell>
  );
}
