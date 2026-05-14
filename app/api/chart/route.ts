import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};

const RANGE_BY_INTERVAL: Record<string, string> = {
  "1m": "1d",
  "5m": "5d",
  "15m": "5d",
  "30m": "1mo",
  "60m": "3mo",
  "1d": "1y",
  "1wk": "5y",
};

function normalizeInterval(interval: string) {
  const allowed = ["1m", "5m", "15m", "30m", "60m", "1d", "1wk"];
  return allowed.includes(interval) ? interval : "1d";
}

function normalizeRange(interval: string, range?: string | null) {
  if (range) return range;
  return RANGE_BY_INTERVAL[interval] || "1y";
}

async function fetchYahooChart(symbol: string, interval: string, range: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(
    interval
  )}&includePrePost=false`;

  const res = await fetch(url, {
    headers: YAHOO_HEADERS,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Yahoo chart 호출 실패: HTTP ${res.status}`);
  }

  const data = await res.json();

  const result = data?.chart?.result?.[0];

  if (!result) {
    throw new Error("차트 데이터를 찾을 수 없습니다.");
  }

  const timestamps: number[] = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};

  const open: number[] = quote.open || [];
  const high: number[] = quote.high || [];
  const low: number[] = quote.low || [];
  const close: number[] = quote.close || [];
  const volume: number[] = quote.volume || [];

  const candles = timestamps
    .map((t, i) => ({
      time: t,
      open: open[i],
      high: high[i],
      low: low[i],
      close: close[i],
      volume: volume[i] || 0,
    }))
    .filter(
      (x) =>
        Number.isFinite(x.time) &&
        Number.isFinite(x.open) &&
        Number.isFinite(x.high) &&
        Number.isFinite(x.low) &&
        Number.isFinite(x.close)
    );

  const meta = result.meta || {};

  return {
    symbol,
    interval,
    range,
    currency: meta.currency || "KRW",
    exchangeName: meta.exchangeName || "",
    regularMarketPrice: meta.regularMarketPrice || candles.at(-1)?.close || 0,
    candles,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const symbol = searchParams.get("symbol");

    if (!symbol) {
      return NextResponse.json(
        { error: "symbol 파라미터가 필요합니다." },
        { status: 400 }
      );
    }

    const interval = normalizeInterval(searchParams.get("interval") || "1d");
    const range = normalizeRange(interval, searchParams.get("range"));

    const data = await fetchYahooChart(symbol, interval, range);

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "차트 데이터 호출 실패" },
      { status: 500 }
    );
  }
}