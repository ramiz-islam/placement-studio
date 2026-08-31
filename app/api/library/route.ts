import { NextResponse } from "next/server";
import { listGenerations, readGeneration } from "@/lib/library";

export const runtime = "nodejs";

/** GET /api/library            -> recent generations
 *  GET /api/library?id=gen-x   -> that generation's PNG */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const png = await readGeneration(id);
    if (!png) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return new NextResponse(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "private, max-age=86400" },
    });
  }
  return NextResponse.json({ entries: await listGenerations() });
}
