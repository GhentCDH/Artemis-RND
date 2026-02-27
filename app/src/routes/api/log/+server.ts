import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const time = body?.time ?? new Date().toISOString();
    const tag = body?.tag ?? "CLIENT";
    const msg = body?.message ?? "";

    console.log(`[${tag}] ${time} ${msg}`);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    console.log("[CLIENT] Failed to parse log payload");
    return new Response(JSON.stringify({ ok: false }), { status: 400 });
  }
};