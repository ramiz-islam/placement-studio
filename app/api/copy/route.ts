/**
 * Headline and CTA generation, including Arabic register work.
 *
 * Runs on Claude rather than the image provider: the brand book forbids
 * machine translation and demands Najdi for KSA and Khaleeji for the UAE,
 * which needs a model that actually holds the register. Output is always
 * labelled a draft in the UI — a native speaker still signs it off.
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Lang } from "@/lib/core";
import { copySystemPrompt, copyUserPrompt, type CopyBrief } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 120;

export interface CopyVariant {
  headline: string;
  cta: string;
  note?: string;
}

export async function POST(req: Request) {
  // PS_ prefixed vars win, so a stale ambient ANTHROPIC_API_KEY cannot shadow .env.local
  const key = process.env.PS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Add ANTHROPIC_API_KEY to .env.local to generate or translate copy." },
      { status: 503 }
    );
  }

  let body: Partial<CopyBrief>;
  try {
    body = (await req.json()) as Partial<CopyBrief>;
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const brief: CopyBrief = {
    brief: body.brief ?? "",
    lang: (body.lang ?? "en") as Lang,
    market: body.market ?? "ksa",
    brandName: body.brandName ?? "CarSwitch",
    source: body.source,
    count: Math.min(Math.max(body.count ?? 4, 1), 8),
    headlineMax: body.headlineMax,
    ctaMax: body.ctaMax,
  };

  if (!brief.brief.trim() && !brief.source?.trim()) {
    return NextResponse.json({ error: "Give it a brief, or some copy to carry across." }, { status: 400 });
  }

  const client = new Anthropic({ apiKey: key });

  try {
    const res = await client.messages.create({
      model: process.env.PS_ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || "claude-opus-5",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: copySystemPrompt(brief),
      messages: [{ role: "user", content: copyUserPrompt(brief) }],
    });

    const text = res.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();

    const variants = parseVariants(text);
    if (!variants.length) {
      return NextResponse.json(
        { error: "Could not read the model's reply as copy. Try again with a tighter brief." },
        { status: 502 }
      );
    }
    return NextResponse.json({ variants, lang: brief.lang });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    const status = e.status ?? 500;
    const message =
      status === 401
        ? "Anthropic rejected the key. Check ANTHROPIC_API_KEY in .env.local."
        : status === 429
          ? "Rate limited. Wait a moment, then retry."
          : `Copy generation failed: ${e.message ?? "unknown error"}`;
    return NextResponse.json({ error: message }, { status });
  }
}

/** Tolerant of a stray code fence or a leading sentence. */
function parseVariants(text: string): CopyVariant[] {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { variants?: CopyVariant[] };
    return (parsed.variants ?? [])
      .filter(v => v && typeof v.headline === "string")
      .map(v => ({ headline: v.headline.trim(), cta: (v.cta ?? "").trim(), note: v.note?.trim() }));
  } catch {
    return [];
  }
}
