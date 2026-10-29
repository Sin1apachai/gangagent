async function request<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", "X-Office-Client": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let b: any;
  try {
    b = await r.json();
  } catch {
    throw new Error("Server response unavailable");
  }
  if (!r.ok) throw new Error(b.error ?? "Request failed");
  return b;
}

export class OfficeApi {
  request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    return request<T>(path, body, method);
  }
}
const client = new OfficeApi();
export const api = client.request.bind(client) as typeof request;
