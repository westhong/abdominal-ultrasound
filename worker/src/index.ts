/**
 * Cloudflare Worker — v2
 *
 * Endpoints:
 *   POST /api/submit  — receives form data, writes to Queue, returns 202
 *   GET  /api/poll    — reads from Queue (v2: Hermes cron calls this)
 */

export interface Env {
  MQ_API_TOKEN?: string;
  ALLOWED_ORIGIN?: string;

  // Queue producer binding (defined in wrangler.toml)
  ABDOMINAL_US_QUEUE: Queue.Queue;
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

    return new Response("Not Found", { status: 404, headers });
  },
};

/**
 * POST /api/submit
 * Validates payload, writes to Cloudflare Queue, returns 202.
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

  try {
    await env.ABDOMINAL_US_QUEUE.send({
      ...(payload as SubmitPayload),
      queuedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[/api/submit] Queue write failed:", err);
    return jsonResponse({ error: "Failed to enqueue job" }, 500, headers);
  }

  console.log("[/api/submit] Job queued:", payload);

  return jsonResponse(
    {
      success: true,
      message: "Job queued",
      petName: (payload as SubmitPayload).petName,
    },
    202,
    headers
  );
}

/**
 * GET /api/poll
 * Reads from Cloudflare Queue, returns list of jobs.
 * Protected by Bearer token (MQ_API_TOKEN).
 *
 * Note: Cloudflare Queues are pull-based — this endpoint reads
 * from the queue and returns messages in a consumable format.
 *
 * TODO (v2): Implement actual queue consumption with visibility timeout.
 *            For now returns a stub so Hermes cron can be wired up.
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

  // ── Queue consumption ──────────────────────────────────────
  // NOTE: Standard Queues are pull-based (Consumer API).
  // This handler is a placeholder — real consumption needs:
  //   1. Cloudflare Queues Consumer binding (wrangler.toml [[queues.consumers]])
  //   2. Or use the Queues REST API to list/increment visibility
  //
  // For Hermes cron: implement as HTTP pull using CF API:
  //   GET /accounts/{cf_account_id}/queues/{queue_id}/messages
  //   with visibility_timeout parameter, then delete after ack.
  //
  // Returning empty for now — Hermes cron integration pending.

  return jsonResponse({ jobs: [] }, 200, headers);
}

function jsonResponse(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
