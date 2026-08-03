export const ADMIN_COOKIE = "its-engineer-admin";
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

export function requestUsesHttps(request: Request) {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProtocol) return forwardedProtocol === "https";
  return new URL(request.url).protocol === "https:";
}

export function readAdminToken(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== ADMIN_COOKIE) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return "";
    }
  }
  return "";
}

export function adminAuthorization(request: Request) {
  const token = readAdminToken(request);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function adminCookie(
  token: string,
  maxAge = ADMIN_SESSION_SECONDS,
  secure = false,
) {
  const attributes = [
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
