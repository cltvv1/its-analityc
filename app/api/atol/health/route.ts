import { proxyAtol } from "../proxy";

export async function GET() {
  return proxyAtol("/health", "GET");
}
