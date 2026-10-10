export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, name: "morphie", version: "2.0.0" });
}
