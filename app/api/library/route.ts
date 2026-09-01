import { NextResponse } from "next/server";
import { deleteGeneration, listGenerations, readGeneration, storageDriver } from "@/lib/library";

export const runtime = "nodejs";

/** GET /api/library            -> recent generations + which driver is storing them
 *  GET /api/library?id=gen-x   -> that generation's PNG (r2 and fs drivers) */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const png = await readGeneration(id);
    if (!png) return NextResponse.json({ error: "Not found." }, { status: 404 });
    // a BlobPart keeps this valid on both the Node and Workers runtimes
    return new NextResponse(new Blob([png], { type: "image/png" }), {
      headers: { "content-type": "image/png", "cache-control": "private, max-age=86400" },
    });
  }
  return NextResponse.json({ entries: await listGenerations(), driver: await storageDriver() });
}

/** DELETE /api/library?id=gen-x */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which one?" }, { status: 400 });
  const ok = await deleteGeneration(id);
  return ok
    ? NextResponse.json({ deleted: id })
    : NextResponse.json({ error: "Could not delete that generation." }, { status: 404 });
}
