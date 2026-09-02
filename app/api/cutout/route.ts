/**
 * Cut the subject out of a creative.
 *
 * The reason this exists: a brand block can only sit *behind* a person if the
 * person exists as a separate layer. Everything else in this app composites
 * over a flat photograph, so a shape is always in front of the subject and the
 * chevron the CarSwitch ads use cannot be reproduced.
 *
 * gpt-image-1 will return a transparent PNG from an edit, so the cut-out comes
 * back as a layer that goes in front while the original stays as the
 * background. It is a generative matte, not a segmentation model: hair and
 * glass edges are where it shows.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  /** data URL of the creative to cut from */
  image?: string | null;
  /** what to keep, when the picture is ambiguous */
  subject?: string | null;
  /** square is cheapest and the layer is scaled to fit anyway */
  size?: "1024x1024" | "1024x1536" | "1536x1024";
}

const PROMPT = [
  "Remove the background completely and return only the main subject on a fully",
  "transparent background. Keep the subject exactly as photographed — same pose,",
  "same lighting, same colours, same crop. Do not redraw, restyle, relight or",
  "extend any part of it. Cut cleanly around hair, hands and clothing edges.",
  "Do not add a shadow, outline, glow or backdrop of any kind.",
].join(" ");

export async function POST(req: Request) {
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
  if (!body.image) {
    return NextResponse.json({ error: "Load a creative first." }, { status: 400 });
  }

  const model = process.env.PS_OPENAI_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const openai = new OpenAI({ apiKey: key });
  const prompt = body.subject?.trim() ? `${PROMPT} The subject to keep is: ${body.subject.trim()}.` : PROMPT;

  try {
    const buf = Buffer.from(body.image.replace(/^data:[^;]+;base64,/, ""), "base64");
    const file = new File([new Uint8Array(buf)], "creative.png", { type: "image/png" });
    const res = await openai.images.edit({
      model,
      image: file,
      prompt,
      size: body.size ?? "1024x1536",
      // the whole point: without this the model fills the background back in
      background: "transparent",
      n: 1,
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json({ error: "The model returned no image. Try again." }, { status: 502 });
    }
    return NextResponse.json({ image: `data:image/png;base64,${b64}`, prompt, model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The cut-out failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
