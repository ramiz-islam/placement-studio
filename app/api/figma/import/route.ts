/**
 * Import a Figma frame as this user.
 *
 * Body: { url, defaults } — the frame link and the kit defaults new layers
 * should take. Returns the same shape the PSD importer produces, so the client
 * applies both the same way.
 *
 * Two trips to Figma: the node tree, then a render of every node that has to
 * arrive as a picture. Figma hands back short-lived URLs on its CDN; they are
 * fetched here and returned as data URLs, because the browser cannot read
 * cross-origin image pixels and the exporter has to.
 */

import { NextResponse } from "next/server";
import { parseFigmaUrl, planFigmaImport, type FigmaNode } from "@/lib/figma";
import { COOKIE, SESSION_MAX_AGE, cookieHeader, figmaEnv, figmaGet, readSession, seal } from "@/lib/figma-session";
import type { NewLayerDefaults } from "@/lib/layers";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  url?: string;
  defaults?: NewLayerDefaults;
}
interface NodesResponse {
  nodes: Record<string, { document: FigmaNode } | null>;
}
interface FileResponse {
  name: string;
  document: FigmaNode;
}
interface ImagesResponse {
  err: string | null;
  images: Record<string, string | null>;
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") || "image/png";
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const sess0 = await readSession(req);
  if (!sess0) return NextResponse.json({ error: "Connect Figma first." }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }
  const link = parseFigmaUrl(body.url ?? "");
  if (!link) {
    return NextResponse.json(
      { error: "That does not look like a Figma link. Copy it from Figma with the frame selected." },
      { status: 400 }
    );
  }
  if (!body.defaults) return NextResponse.json({ error: "Missing layer defaults." }, { status: 400 });

  try {
    let sess = sess0;

    /* ---- the frame ---- */
    let nodeId = link.nodeId;
    if (!nodeId) {
      // no frame in the link: take the first frame on the first page
      const f = await figmaGet<FileResponse>(sess, `/v1/files/${link.fileKey}?depth=2`);
      sess = f.sess;
      const page = f.data.document.children?.[0];
      const frame = page?.children?.find(c => c.type === "FRAME" || c.type === "SECTION" || c.type === "COMPONENT");
      if (!frame) throw new Error("That file has no frame on its first page. Link to a frame instead.");
      nodeId = frame.id;
    }
    const n = await figmaGet<NodesResponse>(sess, `/v1/files/${link.fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`);
    sess = n.sess;
    let root = n.data.nodes[nodeId]?.document;
    if (!root) throw new Error("Figma could not find that frame in the file.");
    let pageNote: string | null = null;
    if (root.type === "CANVAS") {
      // the link points at a page (node 0:1 is always the first page), which
      // has no bounds of its own; take its first frame and say so
      const frame = root.children?.find(c =>
        ["FRAME", "SECTION", "COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(c.type)
      );
      if (!frame) throw new Error("That link points at a page with no frames on it. Select a frame in Figma and copy its link.");
      pageNote = `The link pointed at the page "${root.name}", so its first frame, "${frame.name}", was imported. Select a frame in Figma and Share → Copy link to pick a different one.`;
      root = frame;
    }

    /* ---- the plan, then the pictures it needs ---- */
    const plan = planFigmaImport(root, body.defaults);
    const images: Record<string, string> = {};
    if (plan.needImages.length) {
      // large nodes at 1x, small ones at 2x, so icons stay crisp without a
      // full-frame background coming back at 4k
      const byScale: Record<"1" | "2", string[]> = { "1": [], "2": [] };
      const boxOf = new Map<string, number>();
      const collect = (node: FigmaNode) => {
        const b = node.absoluteBoundingBox;
        if (b) boxOf.set(node.id, Math.max(b.width, b.height));
        node.children?.forEach(collect);
      };
      collect(root);
      for (const id of plan.needImages) byScale[(boxOf.get(id) ?? 0) > 1200 ? "1" : "2"].push(id);

      for (const scale of ["1", "2"] as const) {
        const ids = byScale[scale];
        for (let i = 0; i < ids.length; i += 40) {
          const chunk = ids.slice(i, i + 40);
          const r = await figmaGet<ImagesResponse>(
            sess,
            `/v1/images/${link.fileKey}?ids=${encodeURIComponent(chunk.join(","))}&format=png&scale=${scale}`
          );
          sess = r.sess;
          if (r.data.err) throw new Error(`Figma could not render the frame: ${r.data.err}`);
          await Promise.all(
            Object.entries(r.data.images).map(async ([id, url]) => {
              if (!url) return;
              const data = await toDataUrl(url);
              if (data) images[id] = data;
            })
          );
        }
      }
    }

    const built = plan.build(images);
    const res = NextResponse.json({
      width: plan.width,
      height: plan.height,
      creative: built.creative,
      layers: built.layers,
      notes: pageNote ? [pageNote, ...built.notes] : built.notes,
      user: sess.user ?? null,
    });
    const { cookieSecret } = figmaEnv();
    if (sess !== sess0 && cookieSecret) {
      res.headers.append("set-cookie", cookieHeader(req, COOKIE, await seal(sess, cookieSecret), SESSION_MAX_AGE));
    }
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The Figma import failed.";
    const status = /connect again|no longer accepts/i.test(msg) ? 401 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
