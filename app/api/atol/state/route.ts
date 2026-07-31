import { proxyAtol } from "../proxy";

export async function GET() {
  return proxyAtol("/state", "GET");
}

export async function POST(request: Request) {
  return proxyAtol("/state", "POST", await request.text());
}
