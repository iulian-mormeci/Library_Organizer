import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * GET /api/scan/recent-tracks?limit=20 — the "live feed" for the dashboard:
 * most recently inserted/updated tracks, newest first. During an active
 * scan this is effectively "tracks found in the last couple of seconds",
 * polled alongside /api/scan/status.
 */
export async function GET(request: NextRequest) {
  const limitParam = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const tracks = await prisma.track.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      artist: true,
      album: true,
      filename: true,
      format: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ tracks });
}
