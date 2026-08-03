const BRIDGE_URL =
  process.env.ATOL_BRIDGE_URL ?? "http://127.0.0.1:4317";

export async function proxyAtol(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: string,
  extraHeaders: Record<string, string> = {},
) {
  try {
    const upstream = await fetch(`${BRIDGE_URL}${path}`, {
      method,
      body,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
    });
    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ??
          "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        error:
          "Локальный помощник АТОЛ не запущен на сервере. Перезапустите приложение.",
      },
      { status: 503 },
    );
  }
}
