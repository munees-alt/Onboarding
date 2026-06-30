"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";

export async function setViewAs(memberId: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (session?.profile.role !== "admin") return { error: "Master admin only." };
  const jar = await cookies();
  jar.set("cadence_view_as", memberId, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 8 });
  revalidatePath("/", "layout");
  return {};
}

export async function clearViewAs(): Promise<void> {
  const jar = await cookies();
  jar.delete("cadence_view_as");
  revalidatePath("/", "layout");
}
