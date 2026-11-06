// GET /api/admin/spend -> { spend, cap, killed }. Vercel Web-standard handler (no extra packages).
// Auth: header `x-admin-token` must equal env ADMIN_TOKEN; unset ADMIN_TOKEN fails closed (401).
import { handleSpendRequest } from "../../server/lib/budget";
import { getSpend } from "../../server/lib/llm";

export async function GET(request: Request): Promise<Response> {
  return handleSpendRequest(request, process.env, { spend: getSpend() });
}
