import { proxyAtol } from "../proxy";

export async function POST() {
  return proxyAtol("/sync", "POST");
}
