/**
 * Image generation — OpenAI Images (gpt-image-1).
 *
 * Returns base64 PNGs plus the exact prompt that produced them, so a good
 * result can be understood and repeated rather than re-rolled blindly.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { SHAPES } from "@/lib/core";
import { buildImagePrompt, type ImageBrief } from "@/lib/prompt";
import { saveGeneration, storageDriver } from "@/lib/library";

export const runtime = "nodejs";
// 60s is the ceiling on Vercel Hobby; Pro can raise this to 300.
export const maxDuration = 60;

interface Body extends ImageBrief {
  count?: number;
  quality?: "low" | "medium" | "high";
  /** data URL of an existing creative, for Ad remake */
  reference?: string | null;
}

const dataUrlToBuffer = (url: string) => Buffer.from(url.replace(/^data:[^;]+;base64,/, ""), "base64");

export async function POST(req: Request) {
  // PS_ prefixed vars win, so a stale ambient OPENAI_API_KEY cannot shadow .env.local
  const key = process.env.PS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Add OPENAI_API_KEY to .env.local and restart the dev server." },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }
  if (!body.brief || !body.brief.trim()) {
    return NextResponse.json({ error: "Describe what to make first." }, { status: 400 });
  }

  const shape = SHAPES.find(s => s.id === body.shapeId) || SHAPES[0];
  const count = Math.min(Math.max(body.count ?? 1, 1), 4);
  const hasReference = Boolean(body.reference);
  const prompt = buildImagePrompt({ ...body, hasReference });
  const model = process.env.PS_OPENAI_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const openai = new OpenAI({ apiKey: key });

  try {
    let images: string[] = [];

    if (hasReference && body.reference) {
      // Ad remake — edit the supplied creative rather than starting cold.
      const buf = dataUrlToBuffer(body.reference);
      const file = new File([new Uint8Array(buf)], "reference.png", { type: "image/png" });
      const res = await openai.images.edit({
        model,
        image: file,
        prompt,
        size: shape.size,
        n: count,
      });
      images = (res.data ?? []).map(d => d.b64_json).filter((b): b is string => Boolean(b));
    } else {
      const res = await openai.images.generate({
        model,
        prompt,
        size: shape.size,
        quality: body.quality ?? "high",
        n: count,
      });
      images = (res.data ?? []).map(d => d.b64_json).filter((b): b is string => Boolean(b));
    }

    if (!images.length) {
      return NextResponse.json({ error: "The model returned no image. Try rewording the brief." }, { status: 502 });
    }

    const [w, h] = shape.size.split("x").map(Number);
    const results = [];
    for (const b64 of images) {
      const id = `gen-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
      const png = Buffer.from(b64, "base64");
      const saved = await saveGeneration(id, png, {
        typeId: body.typeId,
        shapeId: body.shapeId,
        market: body.market,
        brief: body.brief,
        prompt,
        width: w,
        height: h,
      });
      results.push({
        id,
        dataUrl: `data:image/png;base64,${b64}`,
        width: w,
        height: h,
        bytes: png.byteLength,
        savedToLibrary: Boolean(saved),
      });
    }

    return NextResponse.json({ prompt, model, driver: storageDriver(), results });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    const status = e.status ?? 500;
    const message =
      status === 401
        ? "OpenAI rejected the key. Check OPENAI_API_KEY in .env.local."
        : status === 429
          ? "Rate limited or out of quota on this key. Wait, then retry."
          : status === 400
            ? `OpenAI rejected the request: ${e.message ?? "bad request"}`
            : `Generation failed: ${e.message ?? "unknown error"}`;
    return NextResponse.json({ error: message }, { status });
  }
}
