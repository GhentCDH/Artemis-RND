// src/routes/api/mirror/+server.ts
import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { generateId } from "@allmaps/id";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

type MirrorItem = {
  manifestUrl: string;
  id?: string;
  allmapsUrl?: string;
  localUrl?: string;
  ok: boolean;
  status?: number;
  error?: string;
  cached?: boolean;
};

const STATIC_DIR = path.resolve("static");
const OUT_DIR = path.join(STATIC_DIR, "annotations", "manifests");

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /api/mirror
 * Body: { manifests: string[], force?: boolean }
 *
 * For each manifest URL:
 *  - generate a stable Allmaps id
 *  - fetch the annotation JSON from annotations.allmaps.org
 *  - store it at: static/annotations/manifests/<id>.json
 *  - return localUrl: /annotations/manifests/<id>.json
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: any = null;

  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const manifestsRaw = body?.manifests;
  const force = Boolean(body?.force);

  if (!Array.isArray(manifestsRaw)) {
    return json({ ok: false, error: "Expected { manifests: string[] }" }, { status: 400 });
  }

  // Clean + de-duplicate while preserving order
  const manifests = manifestsRaw
    .map((s: any) => String(s).trim())
    .filter((s: string) => s.length > 0)
    .filter((s: string, i: number, arr: string[]) => arr.indexOf(s) === i);

  await mkdir(OUT_DIR, { recursive: true });

  const results: MirrorItem[] = [];

  // Sequential mirroring (intentionally): avoids hammering upstream + reduces local instability.
  for (const manifestUrl of manifests) {
    try {
      const id = await generateId(manifestUrl);
      const allmapsUrl = `https://annotations.allmaps.org/manifests/${id}`;
      const diskPath = path.join(OUT_DIR, `${id}.json`);
      const localUrl = `/annotations/manifests/${id}.json`;

      // If already mirrored, skip unless forced
      if (!force && (await fileExists(diskPath))) {
        results.push({
          manifestUrl,
          id,
          allmapsUrl,
          localUrl,
          ok: true,
          cached: true
        });
        continue;
      }

      const r = await fetch(allmapsUrl, {
        headers: { accept: "application/json" }
      });

      if (!r.ok) {
        results.push({
          manifestUrl,
          id,
          allmapsUrl,
          localUrl,
          ok: false,
          status: r.status,
          error: `Upstream HTTP ${r.status}`
        });
        continue;
      }

      const data = await r.json();
      await writeFile(diskPath, JSON.stringify(data, null, 2), "utf-8");

      results.push({
        manifestUrl,
        id,
        allmapsUrl,
        localUrl,
        ok: true,
        cached: false
      });
    } catch (e: any) {
      results.push({
        manifestUrl,
        ok: false,
        error: e?.message ?? String(e)
      });
    }
  }

  return json({
    ok: true,
    count: manifests.length,
    storedUnder: "/static/annotations/manifests/*.json",
    results
  });
};