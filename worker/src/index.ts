/**
 * Cloudflare Worker — v2 (hybrid: API + webapp static server)
 *
 * Endpoints:
 *   GET  /            — serves webapp HTML (from GitHub raw)
 *   GET  /index.html  — alias for /
 *   POST /api/submit  — receives form data, writes to KV queue, returns 202
 *   GET  /api/poll    — reads from KV queue (Hermes cron calls this)
 *   POST /api/complete — marks job as done (Hermes calls after processing)
 */

export interface Env {
  MQ_API_TOKEN?: string;
  ALLOWED_ORIGIN?: string;

  // KV binding for job queue
  ABDOMINAL_US_JOBS: KVNamespace;
}

interface SubmitPayload {
  petName: string;
  species: string;
  breed?: string;
  age?: string;
  gender?: string;
  weight?: string;
  ownerName?: string;
  vetName?: string;
  observations: string;
  organs?: string[];
  submitTime?: string;
}

const ALLOWED_METHODS = ["POST", "GET", "OPTIONS"];

function validatePayload(body: unknown): body is SubmitPayload {
  if (!body || typeof body !== "object") return false;
  const p = body as Record<string, unknown>;
  if (!p.petName || typeof p.petName !== "string") return false;
  if (!p.species || typeof p.species !== "string") return false;
  if (!p.observations || typeof p.observations !== "string") return false;
  if (p.observations.length > 5000) return false;
  return true;
}

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowedOrigin = env.ALLOWED_ORIGIN ?? "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin === "*" ? "*" : origin ?? allowedOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get("Origin");
    const headers = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "POST" && path === "/api/submit") {
      return handleSubmit(request, env, headers, origin);
    }

    if (request.method === "GET" && path === "/api/poll") {
      return handlePoll(request, env, headers);
    }

    if (request.method === "POST" && path === "/api/complete") {
      return handleComplete(request, env, headers);
    }

    // Serve webapp static HTML for root / and /index.html
    if (request.method === "GET" && (path === "/" || path === "/index.html")) {
      return serveWebapp(headers);
    }

    return new Response("Not Found", { status: 404, headers });
  },
};

/**
 * POST /api/submit
 * Validates payload, writes to KV queue, returns 202.
 */
async function handleSubmit(
  request: Request,
  env: Env,
  headers: HeadersInit,
  origin: string | null
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, headers);
  }

  if (!validatePayload(payload)) {
    return jsonResponse({ error: "Missing or invalid required fields" }, 400, headers);
  }

  const typedPayload = payload as SubmitPayload;
  const jobId = crypto.randomUUID();
  const queuedAt = new Date().toISOString();
  const job = { ...typedPayload, jobId, queuedAt };

  try {
    // Write job data to KV
    await env.ABDOMINAL_US_JOBS.put(`job:${jobId}`, JSON.stringify(job));

    // Add to pending_ids list
    const idsRaw = await env.ABDOMINAL_US_JOBS.get("pending_ids");
    const ids: string[] = idsRaw ? JSON.parse(idsRaw) : [];
    ids.push(jobId);
    await env.ABDOMINAL_US_JOBS.put("pending_ids", JSON.stringify(ids));
  } catch (err) {
    console.error("[/api/submit] KV write failed:", err);
    return jsonResponse({ error: "Failed to enqueue job" }, 500, headers);
  }

  console.log("[/api/submit] Job queued:", jobId, typedPayload.petName);

  return jsonResponse(
    {
      success: true,
      message: "Job queued",
      petName: typedPayload.petName,
      jobId,
    },
    202,
    headers
  );
}

/**
 * GET /api/poll
 * Reads pending jobs from KV, returns them for Hermes cron to process.
 * After Hermes ACK, it calls /api/complete to mark done.
 *
 * Flow:
 *   1. Read all pending job IDs from KV list
 *   2. Fetch job data for each ID
 *   3. Mark them as "processing" (visibility timeout ~5min)
 *   4. Return batch to caller
 *
 * Protected by Bearer token (MQ_API_TOKEN).
 */
async function handlePoll(
  request: Request,
  env: Env,
  headers: HeadersInit
): Promise<Response> {
  // Bearer token auth
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();

  if (env.MQ_API_TOKEN && token !== env.MQ_API_TOKEN) {
    return jsonResponse({ error: "Unauthorized" }, 401, headers);
  }

  const POLL_BATCH = 5;
  const VISIBILITY_SECONDS = 300; // 5 min

  try {
    // Step 1: Get pending job IDs
    const idsRaw = await env.ABDOMINAL_US_JOBS.get("pending_ids");
    if (!idsRaw) {
      return jsonResponse({ jobs: [] }, 200, headers);
    }

    let pendingIds: string[] = [];
    try {
      pendingIds = JSON.parse(idsRaw);
    } catch {
      return jsonResponse({ jobs: [], warning: "Corrupted pending_ids, resetting" }, 200, headers);
    }

    // Filter out jobs that are currently processing (visibility timeout not yet expired)
    const now = Date.now();
    const availableIds = pendingIds.filter(async (id) => {
      const metaRaw = await env.ABDOMINAL_US_JOBS.get(`meta:${id}`);
      if (!metaRaw) return true; // no meta means not processing
      try {
        const meta = JSON.parse(metaRaw);
        if (meta.processing && meta.processingUntil && now < meta.processingUntil) {
          return false; // still in flight
        }
      } catch {
        return true;
      }
      return true;
    });

    // Step 2: Take up to POLL_BATCH
    const batchIds = availableIds.slice(0, POLL_BATCH);
    if (batchIds.length === 0) {
      return jsonResponse({ jobs: [] }, 200, headers);
    }

    // Step 3: Fetch job data + mark as processing
    const jobs: (SubmitPayload & { jobId: string; queuedAt: string })[] = [];
    const remainingIds: string[] = [];

    for (const id of pendingIds) {
      if (batchIds.includes(id)) {
        const jobRaw = await env.ABDOMINAL_US_JOBS.get(`job:${id}`);
        if (jobRaw) {
          try {
            const job = JSON.parse(jobRaw);
            jobs.push({ ...job, jobId: id });

            // Mark as processing (visibility timeout)
            await env.ABDOMINAL_US_JOBS.put(
              `meta:${id}`,
              JSON.stringify({ processing: true, processingUntil: now + VISIBILITY_SECONDS * 1000 })
            );
          } catch {
            // skip corrupt job
          }
        }
      } else {
        remainingIds.push(id);
      }
    }

    // Step 4: Update pending_ids list (remove processed from pending, keep in list until ACK)
    // We keep all IDs in pending_ids; batchIds are just "claimed" via meta:
    await env.ABDOMINAL_US_JOBS.put("pending_ids", JSON.stringify(pendingIds));

    return jsonResponse({ jobs }, 200, headers);
  } catch (err) {
    console.error("[/api/poll] KV read failed:", err);
    return jsonResponse({ error: "Failed to read jobs" }, 500, headers);
  }
}

/**
 * POST /api/complete
 * Called by Hermes after job is processed — marks job as done.
 * Body: { jobId: string, success: boolean }
 */
async function handleComplete(
  request: Request,
  env: Env,
  headers: HeadersInit
): Promise<Response> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();

  if (env.MQ_API_TOKEN && token !== env.MQ_API_TOKEN) {
    return jsonResponse({ error: "Unauthorized" }, 401, headers);
  }

  let body: { jobId?: string; success?: boolean };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, headers);
  }

  const { jobId } = body;
  if (!jobId) return jsonResponse({ error: "jobId required" }, 400, headers);

  try {
    // Remove from pending_ids list
    const idsRaw = await env.ABDOMINAL_US_JOBS.get("pending_ids");
    if (idsRaw) {
      const ids: string[] = JSON.parse(idsRaw);
      const filtered = ids.filter((id) => id !== jobId);
      await env.ABDOMINAL_US_JOBS.put("pending_ids", JSON.stringify(filtered));
    }

    // Delete job data and meta
    await env.ABDOMINAL_US_JOBS.delete(`job:${jobId}`);
    await env.ABDOMINAL_US_JOBS.delete(`meta:${jobId}`);

    return jsonResponse({ success: true }, 200, headers);
  } catch (err) {
    console.error("[/api/complete] KV update failed:", err);
    return jsonResponse({ error: "Failed to complete job" }, 500, headers);
  }
}

function jsonResponse(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * Serve webapp HTML fetched from GitHub raw content.
 * GET / or GET /index.html
 */
async function serveWebapp(headers: HeadersInit): Promise<Response> {
  const htmlUrl =
    "https://raw.githubusercontent.com/westhong/abdominal-ultrasound/main/webapp/index.html";

  try {
    const resp = await fetch(htmlUrl);
    if (!resp.ok) {
      return new Response("Failed to load webapp", { status: 502, headers });
    }
    const html = await resp.text();
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
    });
  } catch (err) {
    console.error("[serveWebapp] fetch failed:", err);
    return new Response("Service unavailable", { status: 503, headers });
  }
}
