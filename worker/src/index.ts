/**
 * Cloudflare Worker — v1.0
 *
 * Endpoints:
 *   POST /api/submit  — receives form data, returns 202 (queue pending)
 *   GET  /api/poll    — returns empty jobs list (queue pending)
 *
 * Queue integration (v2):
 *   - Add [[queues.producers]] to wrangler.toml
 *   - Add ABDOMINAL_US_QUEUE to Env interface
 *   - Uncomment queue.write() in /api/submit
 */

export interface Env {
  MQ_API_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
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

const ALLOWED_METHODS = ["POST", "OPTIONS"];

/**
 * Validate the incoming payload.
 */
function validatePayload(body: unknown): body is SubmitPayload {
  if (!body || typeof body !== "object") return false;
  const p = body as Record<string, unknown>;
  if (!p.petName || typeof p.petName !== "string") return false;
  if (!p.species || typeof p.species !== "string") return false;
  if (!p.observations || typeof p.observations !== "string") return false;
  if (p.observations.length > 5000) return false;
  return true;
}

/**
 * CORS headers.
 */
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

    // ── CORS preflight ──────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // ── Route ────────────────────────────────────────────────
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "POST" && path === "/api/submit") {
      return handleSubmit(request, env, headers, origin);
    }

    if (request.method === "GET" && path === "/api/poll") {
      return handlePoll(request, env, headers);
    }

    return new Response("Not Found", { status: 404, headers });
  },
};

/**
 * POST /api/submit
 * Receives form data, validates, returns 202 Accepted.
 *
 * v2: write to Cloudflare Queue here.
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

  // ── v2: write to Queue ────────────────────────────────────
  // TODO (v2): uncomment when Queue is created
  // try {
  //   await env.ABDOMINAL_US_QUEUE.send({
  //     ...payload,
  //     queuedAt: new Date().toISOString(),
  //   });
  // } catch (err) {
  //   console.error("Queue write failed:", err);
  //   return jsonResponse({ error: "Failed to enqueue job" }, 500, headers);
  // }

  console.log("[/api/submit] Job received:", payload);

  return jsonResponse(
    {
      success: true,
      message: "Job queued (v1 stub — Queue pending)",
      petName: payload.petName,
    },
    202,
    headers
  );
}

/**
 * GET /api/poll
 * Returns empty jobs list.
 *
 * v2: read from Cloudflare Queue here, honour MQ_API_TOKEN.
 */
function handlePoll(
  request: Request,
  env: Env,
  headers: HeadersInit
): Response {
  // Bearer token check
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();

  if (env.MQ_API_TOKEN && token !== env.MQ_API_TOKEN) {
    return jsonResponse({ error: "Unauthorized" }, 401, headers);
  }

  // ── v2: read from Queue ────────────────────────────────────
  // TODO (v2): consume from ABDOMINAL_US_QUEUE
  // const jobs = await consumeFromQueue();

  return jsonResponse({ jobs: [] }, 200, headers);
}

function jsonResponse(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
