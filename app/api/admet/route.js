import { NextResponse } from "next/server";
import { cacheGet, cacheSet, clientIp, rateLimit } from "../../../lib/cache.js";
import { predictBatch } from "../../../lib/admetlab.js";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * ADMETlab allows one molecule per request and asks for <=5 req/s, so a chunk
 * of 20 is about 5 seconds of work — comfortably inside a function invocation.
 * The browser calls this repeatedly to walk through 100 compounds, which also
 * means the user sees a progress bar instead of a 20-second stall.
 */
const MAX_CHUNK = 20;

export async function POST(request) {
  const ip = clientIp(request);
  const limited = rateLimit(ip, { scope: "admet", limit: 60, windowSeconds: 600 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${limited.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const input = Array.isArray(body?.smiles) ? body.smiles : [];
  const list = input
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, MAX_CHUNK);

  if (!list.length) {
    return NextResponse.json({ error: "No SMILES supplied." }, { status: 400 });
  }

  // Serve what we already know, predict only the rest. ADMET for a given
  // structure never changes, so this cache is permanently valid.
  const results = [];
  const toPredict = [];
  for (const smiles of list) {
    const cached = await cacheGet(`admetlab:v1:${smiles}`);
    if (cached) results.push({ ...cached, cached: true });
    else toPredict.push(smiles);
  }

  if (toPredict.length) {
    const fresh = await predictBatch(toPredict);
    for (const row of fresh) {
      if (!row.error) await cacheSet(`admetlab:v1:${row.smiles}`, row);
      results.push(row);
    }
  }

  const byInput = new Map(results.map((r) => [r.smiles, r]));
  const ordered = list.map(
    (s) => byInput.get(s) || { smiles: s, error: "no result" }
  );

  return NextResponse.json({
    results: ordered,
    predicted: toPredict.length,
    servedFromCache: list.length - toPredict.length,
    attribution:
      "ADMET predictions by ADMETlab 3.0 (admetlab3.scbdd.com), Xiong et al., Nucleic Acids Research 2024.",
  });
}
