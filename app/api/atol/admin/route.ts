import {
  adminAuthorization,
  adminCookie,
  readAdminToken,
  requestUsesHttps,
} from "../admin-cookie";
import { proxyAtol } from "../proxy";

export async function GET(request: Request) {
  const upstream = await proxyAtol(
    "/admin/status",
    "GET",
    undefined,
    adminAuthorization(request),
  );
  return upstream;
}

export async function POST(request: Request) {
  const upstream = await proxyAtol(
    "/admin/login",
    "POST",
    await request.text(),
  );
  const payload = await upstream.json();
  if (!upstream.ok) {
    return Response.json(payload, { status: upstream.status });
  }

  const { token, ...safePayload } = payload;
  return Response.json(safePayload, {
    headers: {
      "Set-Cookie": adminCookie(
        token,
        undefined,
        requestUsesHttps(request),
      ),
      "Cache-Control": "no-store",
    },
  });
}

export async function DELETE(request: Request) {
  const token = readAdminToken(request);
  const upstream = await proxyAtol(
    "/admin/logout",
    "DELETE",
    undefined,
    token ? { Authorization: `Bearer ${token}` } : {},
  );
  const payload = await upstream.json();
  return Response.json(payload, {
    status: upstream.status,
    headers: {
      "Set-Cookie": adminCookie("", 0, requestUsesHttps(request)),
      "Cache-Control": "no-store",
    },
  });
}
