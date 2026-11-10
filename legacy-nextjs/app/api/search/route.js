import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "../../../lib/cache.js";
import { searchEnamine } from "../../../lib/smallworld.js";
import { hasOnepotKey, searchOnepot } from "../../../lib/onepot.js";

// SmallWorld can take half a minute on a loose distance.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request) {
  const ip = clientIp(request);
  const limited = rateLimit(ip, { scope: "search", limit: 12, windowSeconds: 600 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Too many searches. Try again in ${limited.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const smiles = String(body?.smiles || "").trim();
  if (!smiles) {
    return NextResponse.json({ error: "No SMILES supplied." }, { status: 400 });
  }
  if (smiles.length > 600) {
    return NextResponse.json({ error: "SMILES is implausibly long." }, { status: 400 });
  }

  const useEnamine = body?.enamine !== false;
  const useOnepot = body?.onepot !== false;
  const dist = Math.min(Math.max(Number(body?.dist) || 5, 2), 8);
  const perSource = Math.min(Math.max(Number(body?.perSource) || 300, 20), 500);

  const tasks = [];
  if (useEnamine) {
    tasks.push(
      searchEnamine(smiles, { dist, maxResults: perSource })
        .then((r) => ({ source: "enamine", ...r }))
        .catch((e) => ({ source: "enamine", hits: [], error: String(e.message || e) }))
    );
  }
  if (useOnepot) {
    tasks.push(
      searchOnepot(smiles, { maxResults: perSource })
        .then((r) => ({ source: "onepot", ...r }))
        .catch((e) => ({ source: "onepot", hits: [], error: String(e.message || e) }))
    );
  }

  if (!tasks.length) {
    return NextResponse.json({ error: "No source selected." }, { status: 400 });
  }

  const settled = await Promise.all(tasks);

  const hits = [];
  const sources = {};
  for (const result of settled) {
    hits.push(...(result.hits || []));
    sources[result.source] = {
      count: result.hits?.length || 0,
      cached: Boolean(result.cached),
      error: result.error || null,
      unavailable: result.unavailable || null,
      db: result.db || null,
    };
  }

  return NextResponse.json({
    query: smiles,
    dist,
    hits,
    sources,
    onepotConfigured: hasOnepotKey(),
  });
}
