const TRADING_BASE = process.env.ALPACA_BASE_URL ?? "https://paper-api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";

function authHeaders() {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY_ID!,
    "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET_KEY!,
    "Content-Type": "application/json",
  };
}

async function alpacaFetch<T>(
  base: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new AlpacaError(res.status, path, body);
  }

  // 204 No Content (e.g. cancel order)
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export class AlpacaError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string
  ) {
    super(`Alpaca ${status} on ${path}: ${body}`);
    this.name = "AlpacaError";
  }
}

export const trading = {
  get: <T>(path: string) => alpacaFetch<T>(TRADING_BASE, path),
  post: <T>(path: string, body: unknown) =>
    alpacaFetch<T>(TRADING_BASE, path, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  delete: <T>(path: string) =>
    alpacaFetch<T>(TRADING_BASE, path, { method: "DELETE" }),
};

export const marketData = {
  get: <T>(path: string) => alpacaFetch<T>(DATA_BASE, path),
};
