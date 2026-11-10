import { NextResponse } from "next/server";
import { describeFetchError } from "../../../lib/smallworld.js";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Connectivity diagnostics, run from inside the Vercel function.
 *
 * "fetch failed" in the UI could mean DNS, a refused connection, a TLS
 * problem, a timeout, or an upstream that simply blocks cloud IP ranges —
 * and from a laptop you cannot tell which, because the laptop can reach
 * things the function cannot. This probes each upstream from where the code
 * actually runs and reports what happened.
 *
 * Open /api/diag in a browser. Read-only, no secrets echoed.
 */

async function probe(name, url, { method = "GET", body = null, timeoutMs = 20000 } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "User-Agent": "Nearspace-diagnostics/0.1",
        Accept: "*/*",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    return {
      name,
      url,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      contentType: res.headers.get("content-type"),
      bytes: text.length,
      preview: text.slice(0, 300),
    };
  } catch (err) {
    return {
      name,
      url,
      ok: false,
      ms: Date.now() - started,
      error:
        err?.name === "AbortError"
          ? `timed out after ${timeoutMs}ms`
          : describeFetchError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  // A control probe first: if this fails too, the problem is outbound
  // networking in general, not any particular upstream.
  const results = await Promise.all([
    probe("control (example.com)", "https://example.com"),
    probe("smallworld: list databases", "https://sw.docking.org/search/maps"),
    probe(
      "smallworld: benzene search",
      "https://sw.docking.org/search/view?smi=c1ccccc1&db=REAL_Space&fmt=tsv&start=0&length=5&dist=3"
    ),
    probe("admetlab: wash molecule", "https://admetlab3.scbdd.com/api/washmol", {
      method: "POST",
      body: JSON.stringify({ SMILES: "CCO" }),
    }),
  ]);

  const control = results.find((r) => r.name.startsWith("control"));
  const upstreams = results.filter((r) => !r.name.startsWith("control"));

  let verdict;
  if (!control?.ok) {
    verdict =
      "Outbound HTTPS is failing in general — even example.com is unreachable. " +
      "This is not specific to the chemistry services.";
  } else if (upstreams.every((r) => r.ok)) {
    verdict = "All upstreams reachable from this function.";
  } else {
    const broken = upstreams.filter((r) => !r.ok).map((r) => r.name);
    verdict =
      `Outbound works (example.com is fine) but these failed: ${broken.join(", ")}. ` +
      "That points at the upstream itself — unreachable, blocking this host, or down.";
  }

  return NextResponse.json(
    {
      verdict,
      region: process.env.VERCEL_REGION || null,
      runtime: process.version,
      checkedAt: new Date().toISOString(),
      results,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
