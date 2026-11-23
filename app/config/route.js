import {publicConfig} from "../../lib/auth.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json(publicConfig(), {headers: {"Cache-Control": "no-store"}});
  } catch (error) {
    return Response.json({detail: error.message}, {status: 503, headers: {"Cache-Control": "no-store"}});
  }
}
