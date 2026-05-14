"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
} from "lightweight-charts";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type Props = {
  symbol: string;
  company?: string;
};

const intervals = [
  { label: "1분", interval: "1m", range: "1d" },
  { label: "5분", interval: "5m", range: "5d" },
  { label: "15분", interval: "15m", range: "5d" },
  { label: "30분", interval: "30m", range: "1mo" },
  { label: "60분", interval: "60m", range: "3mo" },
  { label: "일봉", interval: "1d", range: "1y" },
  { label: "주봉", interval: "1wk", range: "5y" },
];

function fmt(n: any) {
  if (n == null || isNaN(n)) return "-";
  return Number(n).toLocaleString("ko-KR");
}

export default function StockAppChart({ symbol, company }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const trendSeriesRefs = useRef<any[]>([]);

  const drawModeRef = useRef(false);
  const trendStartRef = useRef<any>(null);

  const [interval, setIntervalValue] = useState("1d");
  const [range, setRange] = useState("1y");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [drawMode, setDrawMode] = useState(false);
  const [trendStart, setTrendStart] = useState<any>(null);
  const [trendLines, setTrendLines] = useState<any[]>([]);
  const [lastPrice, setLastPrice] = useState(0);

  async function loadChart(nextInterval = interval, nextRange = range) {
    if (!symbol) return;

    setLoading(true);
    setErr("");

    try {
      const res = await fetch(
        `/api/chart?symbol=${encodeURIComponent(
          symbol
        )}&interval=${encodeURIComponent(nextInterval)}&range=${encodeURIComponent(
          nextRange
        )}`
      );

      const j = await res.json();

      if (j.error) throw new Error(j.error);

      const nextCandles = j.candles || [];

      setCandles(nextCandles);
      setLastPrice(j.regularMarketPrice || nextCandles.at(-1)?.close || 0);
    } catch (e: any) {
      setErr(e.message || "차트 데이터 호출 실패");
      setCandles([]);
    }

    setLoading(false);
  }

  useEffect(() => {
    drawModeRef.current = drawMode;
  }, [drawMode]);

  useEffect(() => {
    trendStartRef.current = trendStart;
  }, [trendStart]);

  useEffect(() => {
    loadChart(interval, range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      trendSeriesRefs.current = [];
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 430,
      layout: {
        background: { type: ColorType.Solid, color: "rgba(8,12,24,0)" },
        textColor: "#8f9bb0",
        fontFamily: "'IBM Plex Mono', monospace",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.08)",
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00e5b0",
      downColor: "#ff6b6b",
      borderUpColor: "#00e5b0",
      borderDownColor: "#ff6b6b",
      wickUpColor: "#00e5b0",
      wickDownColor: "#ff6b6b",
      priceFormat: {
        type: "price",
        precision: 0,
        minMove: 1,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    const resize = () => {
      if (!containerRef.current || !chartRef.current) return;

      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
      });
    };

    window.addEventListener("resize", resize);

    chart.subscribeClick((param: any) => {
      if (!drawModeRef.current) return;
      if (!param.time || !param.point || !candleSeriesRef.current) return;

      const price = candleSeriesRef.current.coordinateToPrice(param.point.y);

      if (!price) return;

      const point = {
        time: param.time,
        price,
      };

      if (!trendStartRef.current) {
        trendStartRef.current = point;
        setTrendStart(point);
      } else {
        const nextLine = {
          start: trendStartRef.current,
          end: point,
        };

        setTrendLines((prev) => [...prev, nextLine]);

        trendStartRef.current = null;
        setTrendStart(null);
      }
    });

    return () => {
      window.removeEventListener("resize", resize);

      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !chartRef.current) return;

    const formatted = candles.map((x) => ({
      time: x.time,
      open: x.open,
      high: x.high,
      low: x.low,
      close: x.close,
    }));

    candleSeriesRef.current.setData(formatted);

    if (formatted.length > 0) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles]);

  useEffect(() => {
    if (!chartRef.current) return;

    trendSeriesRefs.current.forEach((series) => {
      try {
        chartRef.current.removeSeries(series);
      } catch {}
    });

    trendSeriesRefs.current = [];

    trendLines.forEach((line) => {
      const lineSeries = chartRef.current.addSeries(LineSeries, {
        color: "#ffd166",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      lineSeries.setData([
        {
          time: line.start.time,
          value: line.start.price,
        },
        {
          time: line.end.time,
          value: line.end.price,
        },
      ]);

      trendSeriesRefs.current.push(lineSeries);
    });
  }, [trendLines]);

  const selected = intervals.find((x) => x.interval === interval);

  const first = candles[0];
  const last = candles[candles.length - 1];

  const change =
    first && last && first.open
      ? ((last.close - first.open) / first.open) * 100
      : 0;

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 22,
        border: "1px solid rgba(255,255,255,0.08)",
        background:
          "linear-gradient(135deg, rgba(13,18,34,0.94), rgba(8,12,24,0.72))",
        boxShadow: "0 20px 56px rgba(0,0,0,0.24)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div style={{ marginRight: "auto" }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 900,
              color: "#f5f7fb",
              letterSpacing: -0.4,
            }}
          >
            {company || symbol} Chart
          </div>

          <div
            style={{
              fontSize: 10,
              color: "#75839a",
              fontFamily: "'IBM Plex Mono', monospace",
              marginTop: 3,
            }}
          >
            {symbol} · {selected?.label || interval} · {range}
          </div>
        </div>

        <div
          style={{
            color: change >= 0 ? "#00e5b0" : "#ff6b6b",
            fontSize: 18,
            fontWeight: 900,
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          {fmt(lastPrice)}원
        </div>

        <div
          style={{
            padding: "5px 8px",
            borderRadius: 999,
            background:
              change >= 0 ? "rgba(0,229,176,0.08)" : "rgba(255,107,107,0.08)",
            border:
              change >= 0
                ? "1px solid rgba(0,229,176,0.18)"
                : "1px solid rgba(255,107,107,0.18)",
            color: change >= 0 ? "#00e5b0" : "#ff6b6b",
            fontSize: 11,
            fontWeight: 800,
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          {change >= 0 ? "+" : ""}
          {change.toFixed(2)}%
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        {intervals.map((x) => (
          <button
            key={x.interval}
            onClick={() => {
              setIntervalValue(x.interval);
              setRange(x.range);
              loadChart(x.interval, x.range);
            }}
            style={{
              padding: "7px 10px",
              borderRadius: 10,
              border:
                interval === x.interval
                  ? "1px solid rgba(0,229,176,0.45)"
                  : "1px solid rgba(255,255,255,0.08)",
              background:
                interval === x.interval
                  ? "rgba(0,229,176,0.11)"
                  : "rgba(255,255,255,0.035)",
              color: interval === x.interval ? "#00e5b0" : "#8f9bb0",
              fontSize: 10,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {x.label}
          </button>
        ))}

        <button
          onClick={() => {
            setDrawMode((v) => !v);
            setTrendStart(null);
            trendStartRef.current = null;
          }}
          style={{
            padding: "7px 10px",
            borderRadius: 10,
            border: drawMode
              ? "1px solid rgba(255,209,102,0.55)"
              : "1px solid rgba(255,255,255,0.08)",
            background: drawMode
              ? "rgba(255,209,102,0.11)"
              : "rgba(255,255,255,0.035)",
            color: drawMode ? "#ffd166" : "#8f9bb0",
            fontSize: 10,
            fontWeight: 800,
            cursor: "pointer",
            marginLeft: 6,
          }}
        >
          추세선 {drawMode ? "ON" : "OFF"}
        </button>

        <button
          onClick={() => {
            setTrendLines([]);
            setTrendStart(null);
            trendStartRef.current = null;
          }}
          style={{
            padding: "7px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255,107,107,0.2)",
            background: "rgba(255,107,107,0.07)",
            color: "#ff8b8b",
            fontSize: 10,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          선 지우기
        </button>
      </div>

      {drawMode && (
        <div
          style={{
            marginBottom: 12,
            padding: "9px 11px",
            borderRadius: 12,
            background: "rgba(255,209,102,0.08)",
            border: "1px solid rgba(255,209,102,0.18)",
            color: "#ffd166",
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          추세선 모드: 차트에서 시작점과 끝점을 차례대로 클릭하세요.
          {trendStart ? " 현재 시작점이 선택되었습니다." : ""}
        </div>
      )}

      {err && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 12,
            background: "rgba(255,107,107,0.07)",
            border: "1px solid rgba(255,107,107,0.2)",
            color: "#ff8b8b",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {err}
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          width: "100%",
          minHeight: 430,
          opacity: loading ? 0.45 : 1,
          transition: "opacity 0.2s ease",
        }}
      />

      {loading && (
        <div
          style={{
            marginTop: 10,
            color: "#00e5b0",
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          차트 데이터를 불러오는 중...
        </div>
      )}
    </div>
  );
}