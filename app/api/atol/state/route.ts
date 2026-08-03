import { proxyAtol } from "../proxy";
import { adminAuthorization } from "../admin-cookie";

export async function GET() {
  return proxyAtol("/state", "GET");
}

export async function POST(request: Request) {
  return proxyAtol(
    "/state",
    "POST",
    await request.text(),
    adminAuthorization(request),
  );
}
