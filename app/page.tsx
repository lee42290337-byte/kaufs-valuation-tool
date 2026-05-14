// @ts-nocheck

"use client";

import { useState, useCallback, useMemo } from "react";
import StockAppChart from "./components/StockAppChart";

const TABS = [
  "산업 분석",
  "과거 실적",
  "추정 수정 ✏️",
  "추정 손익계산서",
  "DCF",
  "상대가치(PER/PBR)",
  "민감도",
  "주가/WACC 추이",
  "최신 뉴스",
];

const DEFAULT_FY = ["2025E", "2026E", "2027E", "2028E", "2029E"];

const COLORS = {
  bg: "#060813",
  panel: "rgba(13,18,34,0.82)",
  panel2: "rgba(8,12,24,0.72)",
  border: "rgba(255,255,255,0.08)",
  border2: "rgba(0,229,176,0.18)",
  text: "#d9e2ef",
  muted: "#75839a",
  dim: "#465266",
  green: "#00e5b0",
  blue: "#00a3ff",
  red: "#ff6b6b",
  yellow: "#f7c948",
};

function fmt(n: any, d = 0) {
  if (n == null || isNaN(n)) return "-";
  const a = Math.abs(Number(n));
  return (
    (Number(n) < 0 ? "(" : "") +
    a.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (Number(n) < 0 ? ")" : "")
  );
}

function fmtNum(n: any, d = 2) {
  if (n == null || isNaN(n)) return "-";
  return Number(n).toFixed(d).replace(/\.?0+$/, "");
}

function pct(n: any) {
  return n == null || isNaN(n) ? "-" : (Number(n) * 100).toFixed(1) + "%";
}

function mult(n: any) {
  return n == null || isNaN(n) ? "-" : Number(n).toFixed(1) + "x";
}

function buildModel(d: any, a: any) {
  const h = d.historical;
  const hy = h.years.length;
  const fyYears = d.forecast_years?.length ? d.forecast_years : DEFAULT_FY;
  const fy = fyYears.length;

  const years = [...h.years, ...fyYears];

  const rev = [...h.revenue];
  const cogs = [...(h.cogs || h.revenue.map((r: number) => Math.round(r * 0.65)))];
  const sga = [...(h.sga || h.revenue.map((r: number) => Math.round(r * 0.15)))];
  const da = [...(h.da || h.revenue.map((r: number) => Math.round(r * 0.05)))];
  const op = [...h.op];
  const interest = [...(h.interest || Array(hy).fill(0))];
  const ni = [...h.ni];

  const getArr = (key: string, i: number, fallback: number) =>
    Number(a?.[key]?.[i] ?? fallback);

  const tax = Number(a.tax_rate ?? 0.22);

  const rf = Number(a.rf ?? 0.035);
  const rm = Number(a.rm ?? 0.085);
  const beta = Number(a.beta ?? 1.0);
  const kd = Number(a.kd ?? 0.045);

  const ke = rf + beta * (rm - rf);

  const wd = Math.min(Math.max(Number(a.debt_weight ?? 0.25), 0), 0.95);
  const we = 1 - wd;

  const wacc = we * ke + wd * kd * (1 - tax);

  for (let i = 0; i < fy; i++) {
    const prevRev = rev[rev.length - 1];

    const manualRev = prevRev * (1 + getArr("rev_growth", i, 0.03));
    const consRev = Number(a.consensus_revenue?.[i] || 0);
    const useConsRev = a.use_consensus && consRev > 0;

    const r = useConsRev ? consRev : manualRev;
    rev.push(Math.round(r));

    const cogsPct = getArr("cogs_pct", i, 0.65);
    const sgaPct = getArr("sga_pct", i, 0.15);
    const daPct = getArr("da_pct", i, 0.05);

    cogs.push(Math.round(r * cogsPct));
    sga.push(Math.round(r * sgaPct));
    da.push(Math.round(r * daPct));

    const manualEbit = Math.round(r * (1 - cogsPct - sgaPct - daPct));
    const consOp = Number(a.consensus_op?.[i] || 0);
    const ebit = a.use_consensus && consOp > 0 ? consOp : manualEbit;

    op.push(Math.round(ebit));

    const nextInterest = Math.round((interest[interest.length - 1] || 0) * 0.9);
    interest.push(nextInterest);

    const consNi = Number(a.consensus_ni?.[i] || 0);
    const nextNi =
      a.use_consensus && consNi > 0
        ? consNi
        : Math.round((ebit + nextInterest) * (1 - tax));

    ni.push(Math.round(nextNi));
  }

  const gp = rev.map((r: number, i: number) => r - cogs[i]);

  const opm = rev.map((r: number, i: number) => (r ? op[i] / r : 0));
  const npm = rev.map((r: number, i: number) => (r ? ni[i] / r : 0));
  const gpm = rev.map((r: number, i: number) => (r ? gp[i] / r : 0));

  const fcff = [];

  for (let i = 0; i < fy; i++) {
    const idx = hy + i;

    fcff.push(
      Math.round(
        op[idx] * (1 - tax) +
          da[idx] -
          rev[idx] * getArr("capex_pct", i, 0.05) -
          rev[idx] * getArr("nwc_pct", i, 0.01)
      )
    );
  }

  const pvF = fcff.map(
    (f: number, i: number) => f / Math.pow(1 + wacc, i + 1)
  );

  const sumPv = pvF.reduce((s: number, v: number) => s + v, 0);

  const tv =
    wacc > Number(a.tgr)
      ? (fcff[fy - 1] * (1 + Number(a.tgr))) / (wacc - Number(a.tgr))
      : 0;

  const pvTv = tv / Math.pow(1 + wacc, fy);

  const ev = sumPv + pvTv;
  const eqVal = ev - Number(a.net_debt || 0);

  const targetDCF = d.shares > 0 ? (eqVal / d.shares) * 100 : 0;
  const epsF = d.shares > 0 ? (ni[hy] / d.shares) * 100 : 0;

  const bpsF =
    (h.bps?.[hy - 1] || 0) + (d.shares > 0 ? (ni[hy] / d.shares) * 100 : 0);

  const peers = a.peers || [];

  const perPeers = peers.filter((p: any) => Number(p.per) > 0);
  const pbrPeers = peers.filter((p: any) => Number(p.pbr) > 0);

  const avgPER = perPeers.length
    ? perPeers.reduce((s: number, p: any) => s + Number(p.per || 0), 0) /
      perPeers.length
    : d.industry?.avgPER || 10;

  const avgPBR = pbrPeers.length
    ? pbrPeers.reduce((s: number, p: any) => s + Number(p.pbr || 0), 0) /
      pbrPeers.length
    : d.industry?.avgPBR || 1.0;

  const premiumMult = 1 + Number(a.premium_pct || 0);

  const tPER = epsF * avgPER * premiumMult;
  const tPBR = bpsF * avgPBR * premiumMult;

  const wD = a.w_dcf ?? 0.6;
  const wP = a.w_per ?? 0.2;
  const wB = a.w_pbr ?? 0.2;

  const blended = targetDCF * wD + tPER * wP + tPBR * wB;

  const wR = [0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13];
  const gR = [0.01, 0.015, 0.02, 0.025, 0.03, 0.035];

  const sensM = wR.map((w) =>
    gR.map((g) => {
      if (w <= g) return null;

      const p = fcff
        .map((f, i) => f / Math.pow(1 + w, i + 1))
        .reduce((s, v) => s + v, 0);

      const t = (fcff[fy - 1] * (1 + g)) / (w - g);

      return d.shares > 0
        ? Math.round(
            ((p + t / Math.pow(1 + w, fy) - a.net_debt) / d.shares) * 100
          )
        : 0;
    })
  );

  const waccTrend = h.years.map((_: any, i: number) => {
    const assets = Number(h.total_assets?.[i] || 0);
    const equity = Number(h.total_equity?.[i] || 0);
    const debt = Math.max(assets - equity, 0);
    const capital = debt + equity;

    const histWd = capital > 0 ? debt / capital : wd;
    const histWe = 1 - histWd;

    return histWe * ke + histWd * kd * (1 - tax);
  });

  return {
    fyYears,
    years,
    rev,
    cogs,
    gp,
    sga,
    da,
    op,
    interest,
    ni,
    opm,
    npm,
    gpm,
    fcff,
    pvF,
    sumPv,
    tv,
    pvTv,
    ev,
    eqVal,
    targetDCF,
    epsF,
    bpsF,
    avgPER,
    avgPBR,
    tPER,
    tPBR,
    blended,
    wR,
    gR,
    sensM,
    wD,
    wP,
    wB,
    rf,
    rm,
    beta,
    kd,
    ke,
    wd,
    we,
    wacc,
    waccTrend,
  };
}

function EC({ value, onChange, f = "pct" }: any) {
  const safe = Number(value ?? 0);

  const disp =
    f === "pct"
      ? (safe * 100).toFixed(1)
      : safe.toFixed(2).replace(/\.?0+$/, "");

  const [ed, setEd] = useState(false);
  const [tmp, setTmp] = useState(disp);

  const commit = () => {
    setEd(false);

    let v = parseFloat(tmp);

    if (!isNaN(v)) {
      if (f === "pct") v /= 100;
      onChange(v);
    }
  };

  if (ed) {
    return (
      <input
        autoFocus
        value={tmp}
        onChange={(e) => setTmp(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEd(false);
        }}
        style={{
          width: 72,
          padding: "4px 6px",
          background: "#08111f",
          border: `1px solid ${COLORS.green}`,
          borderRadius: 6,
          color: COLORS.green,
          fontSize: 11,
          textAlign: "right",
          outline: "none",
          fontFamily: "'IBM Plex Mono',monospace",
          boxShadow: "0 0 14px rgba(0,229,176,0.18)",
        }}
      />
    );
  }

  return (
    <span
      onClick={() => {
        setTmp(disp);
        setEd(true);
      }}
      style={{
        cursor: "pointer",
        padding: "4px 8px",
        borderRadius: 6,
        background: "rgba(0,163,255,0.08)",
        border: "1px dashed rgba(0,163,255,0.28)",
        color: "#77c7ff",
        fontSize: 11,
        fontFamily: "'IBM Plex Mono',monospace",
        display: "inline-block",
        minWidth: 64,
        textAlign: "right",
      }}
      title="클릭하여 수정"
    >
      {f === "pct" ? pct(value) : fmtNum(value)}
    </span>
  );
}

function T({ headers, rows, formats, highlight, colStyles }: any) {
  return (
    <div
      style={{
        overflowX: "auto",
        marginBottom: 16,
        borderRadius: 14,
        border: `1px solid ${COLORS.border}`,
        background: "rgba(8,12,24,0.42)",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 11,
          fontFamily: "'IBM Plex Mono',monospace",
        }}
      >
        <thead>
          <tr>
            {headers.map((h: string, i: number) => (
              <th
                key={i}
                style={{
                  padding: "9px 10px",
                  background:
                    "linear-gradient(180deg, rgba(18,25,46,0.95), rgba(12,17,32,0.95))",
                  color: "#73819a",
                  textAlign: i === 0 ? "left" : "right",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                  fontSize: 10,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row: any, ri: number) => (
            <tr
              key={ri}
              style={{
                background: highlight?.(ri)
                  ? "rgba(0,229,176,0.045)"
                  : "transparent",
              }}
            >
              {row.map((cell: any, ci: number) => (
                <td
                  key={ci}
                  style={{
                    padding: "7px 10px",
                    borderBottom: "1px solid rgba(255,255,255,0.035)",
                    textAlign: ci === 0 ? "left" : "right",
                    whiteSpace: "nowrap",
                    fontWeight: highlight?.(ri) ? 700 : 400,
                    color: colStyles?.(ci, ri) ?? "#a1adbd",
                    ...(typeof cell === "number" && cell < 0
                      ? { color: COLORS.red }
                      : {}),
                  }}
                >
                  {formats?.[ci] ? formats[ci](cell) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Mx({ rL, cL, data, rF, cF, cFmt, bR, bC }: any) {
  return (
    <div
      style={{
        overflowX: "auto",
        marginBottom: 16,
        borderRadius: 14,
        border: `1px solid ${COLORS.border}`,
        background: "rgba(8,12,24,0.42)",
      }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          fontSize: 10,
          fontFamily: "'IBM Plex Mono',monospace",
          minWidth: 620,
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                padding: "8px 9px",
                background: "#10182b",
                color: COLORS.muted,
              }}
            ></th>

            {cL.map((c: any, i: number) => (
              <th
                key={i}
                style={{
                  padding: "8px 9px",
                  background: "#10182b",
                  color: COLORS.muted,
                  textAlign: "center",
                  minWidth: 72,
                }}
              >
                {cF?.(c) ?? c}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rL.map((rl: any, ri: number) => (
            <tr key={ri}>
              <td
                style={{
                  padding: "8px 9px",
                  background: "rgba(17,24,43,0.65)",
                  color: COLORS.muted,
                  fontWeight: 700,
                }}
              >
                {rF?.(rl) ?? rl}
              </td>

              {data[ri].map((v: any, ci: number) => {
                const isB = ri === bR && ci === bC;

                return (
                  <td
                    key={ci}
                    style={{
                      padding: "8px 9px",
                      textAlign: "center",
                      background: isB ? "rgba(0,229,176,0.12)" : "transparent",
                      color: isB ? COLORS.green : v == null ? "#253044" : "#9ca8bb",
                      fontWeight: isB ? 800 : 400,
                      borderBottom: "1px solid rgba(255,255,255,0.035)",
                    }}
                  >
                    {v == null ? "-" : cFmt?.(v) ?? fmt(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniLine({ data, xKey = "date", yKey = "close", yFmt = fmt }: any) {
  if (!data || data.length < 2) {
    return (
      <div
        style={{
          fontSize: 12,
          color: COLORS.muted,
          padding: 18,
          borderRadius: 16,
          border: `1px solid ${COLORS.border}`,
          background: COLORS.panel2,
        }}
      >
        표시할 데이터가 부족합니다.
      </div>
    );
  }

  const w = 820;
  const h = 260;
  const pad = 38;

  const vals = data
    .map((d: any) => Number(d[yKey]))
    .filter((v: number) => Number.isFinite(v));

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const points = data
    .map((d: any, i: number) => {
      const x = pad + (i / (data.length - 1)) * (w - pad * 2);
      const y =
        h - pad - ((Number(d[yKey]) - min) / range) * (h - pad * 2);

      return `${x},${y}`;
    })
    .join(" ");

  const first = data[0];
  const last = data[data.length - 1];

  return (
    <div
      style={{
        overflowX: "auto",
        background:
          "linear-gradient(135deg, rgba(13,18,34,0.92), rgba(8,12,24,0.72))",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 18,
        padding: 16,
        marginBottom: 16,
        boxShadow: "0 18px 44px rgba(0,0,0,0.18)",
      }}
    >
      <svg width={w} height={h}>
        <defs>
          <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={COLORS.green} />
            <stop offset="100%" stopColor={COLORS.blue} />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <line
          x1={pad}
          y1={pad}
          x2={pad}
          y2={h - pad}
          stroke="rgba(255,255,255,0.08)"
        />
        <line
          x1={pad}
          y1={h - pad}
          x2={w - pad}
          y2={h - pad}
          stroke="rgba(255,255,255,0.08)"
        />

        {[0.25, 0.5, 0.75].map((r) => (
          <line
            key={r}
            x1={pad}
            y1={pad + r * (h - pad * 2)}
            x2={w - pad}
            y2={pad + r * (h - pad * 2)}
            stroke="rgba(255,255,255,0.04)"
          />
        ))}

        <polyline
          points={points}
          fill="none"
          stroke="url(#lineGradient)"
          strokeWidth="2.6"
          filter="url(#glow)"
        />

        <text x={pad} y={22} fill={COLORS.muted} fontSize="10">
          {yFmt(max)}
        </text>
        <text x={pad} y={h - 12} fill={COLORS.muted} fontSize="10">
          {yFmt(min)}
        </text>
        <text x={pad} y={h - 2} fill={COLORS.dim} fontSize="10">
          {first?.[xKey]}
        </text>
        <text x={w - pad - 96} y={h - 2} fill={COLORS.dim} fontSize="10">
          {last?.[xKey]}
        </text>
      </svg>
    </div>
  );
}

function InfoCard({ title, items }: any) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 18,
        background:
          "linear-gradient(145deg, rgba(13,18,34,0.9), rgba(8,12,24,0.66))",
        border: `1px solid ${COLORS.border}`,
        boxShadow: "0 18px 48px rgba(0,0,0,0.18)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          color: "#d6e3f4",
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: COLORS.green,
            boxShadow: "0 0 14px rgba(0,229,176,0.75)",
          }}
        />
        {title}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {items?.map((x: string, i: number) => (
          <div
            key={i}
            style={{
              fontSize: 11,
              color: "#9ca8bb",
              lineHeight: 1.55,
            }}
          >
            • {x}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: any) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 18,
        background:
          "linear-gradient(145deg, rgba(13,18,34,0.96), rgba(8,12,24,0.72))",
        border: `1px solid ${COLORS.border}`,
        boxShadow: "0 18px 48px rgba(0,0,0,0.18)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          right: -20,
          top: -20,
          width: 70,
          height: 70,
          borderRadius: "50%",
          background: "rgba(0,229,176,0.07)",
          filter: "blur(4px)",
        }}
      />

      <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 19,
          fontWeight: 900,
          color: COLORS.green,
          letterSpacing: -0.4,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 9, color: COLORS.dim, marginTop: 6 }}>{sub}</div>
      )}
    </div>
  );
}

function Landing() {
  return (
    <div
      style={{
        margin: "36px 18px",
        padding: 34,
        maxWidth: 940,
        borderRadius: 28,
        border: `1px solid ${COLORS.border}`,
        background:
          "linear-gradient(135deg, rgba(13,18,34,0.92), rgba(8,12,24,0.64))",
        boxShadow: "0 26px 80px rgba(0,0,0,0.32)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          right: -90,
          top: -100,
          width: 260,
          height: 260,
          borderRadius: "50%",
          background: "rgba(0,163,255,0.13)",
          filter: "blur(18px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -80,
          bottom: -120,
          width: 260,
          height: 260,
          borderRadius: "50%",
          background: "rgba(0,229,176,0.11)",
          filter: "blur(18px)",
        }}
      />

      <div style={{ position: "relative", zIndex: 1 }}>
        <div
          style={{
            fontSize: 11,
            color: COLORS.green,
            fontWeight: 900,
            letterSpacing: 1.8,
            marginBottom: 14,
          }}
        >
          KOREA AEROSPACE UNIVERSITY · FIS RESEARCH TEAM
        </div>

        <div
          style={{
            fontSize: 40,
            lineHeight: 1.12,
            fontWeight: 950,
            letterSpacing: -1.8,
            color: "#f5f7fb",
            marginBottom: 16,
          }}
        >
          Equity Valuation
          <br />
          Research Terminal
        </div>

        <div
          style={{
            fontSize: 13,
            color: "#96a3b8",
            lineHeight: 1.78,
            maxWidth: 720,
          }}
        >
          한국항공대학교 경영학과 재무금융학회 FIS 리서치팀을 위한
          기업가치평가 대시보드입니다. DART 재무제표, 실시간 주가, 산업 분석,
          Peer Valuation, DCF, WACC, 민감도 분석, 뉴스 모니터링을 하나의
          리서치 화면에서 확인할 수 있습니다.
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 24,
          }}
        >
          {[
            "DART Financials",
            "DCF Model",
            "WACC / CAPM",
            "Peer PER·PBR",
            "Industry Research",
            "News Monitor",
            "Candle Chart",
          ].map((x) => (
            <span
              key={x}
              style={{
                padding: "8px 11px",
                borderRadius: 999,
                background: "rgba(0,229,176,0.075)",
                border: "1px solid rgba(0,229,176,0.18)",
                color: "#9debd9",
                fontSize: 10,
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              {x}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [prog, setProg] = useState("");
  const [raw, setRaw] = useState<any>(null);
  const [a, setA] = useState<any>(null);
  const [tab, setTab] = useState(0);
  const [err, setErr] = useState("");

  const ua = useCallback(
    (k: string, v: any) => setA((p: any) => ({ ...p, [k]: v })),
    []
  );

  const m = useMemo(() => (raw && a ? buildModel(raw, a) : null), [raw, a]);

  const go = useCallback(async () => {
    if (!query.trim()) return;

    setLoading(true);
    setErr("");
    setRaw(null);
    setA(null);
    setProg("DART 실적, 산업 데이터, 주가, 뉴스 데이터를 수집 중...");

    try {
      const res = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });

      const j = await res.json();

      if (j.error) throw new Error(j.error);

      const p = j.content;

      setRaw(p);
      setA({
        ...p.assumptions,
        consensus_revenue: p.assumptions?.consensus_revenue || Array(5).fill(0),
        consensus_op: p.assumptions?.consensus_op || Array(5).fill(0),
        consensus_ni: p.assumptions?.consensus_ni || Array(5).fill(0),
        consensus_eps: p.assumptions?.consensus_eps || Array(5).fill(0),
        w_dcf: 0.6,
        w_per: 0.2,
        w_pbr: 0.2,
      });
      setTab(0);
    } catch (e: any) {
      setErr("오류: " + e.message);
    }

    setLoading(false);
    setProg("");
  }, [query]);

  const d = raw;
  const h = raw?.historical;

  const hMetrics = useMemo(() => {
    if (!h) return null;

    const opm = h.revenue.map((r: number, i: number) =>
      r ? h.op[i] / r : 0
    );

    const growth = h.revenue.map((r: number, i: number) =>
      i === 0 ? null : (r - h.revenue[i - 1]) / h.revenue[i - 1]
    );

    return { opm, growth };
  }, [h]);

  const upside =
    d?.price && m?.blended ? ((m.blended / d.price - 1) * 100).toFixed(1) : "-";

  const waccBaseRow =
    m?.wR?.reduce((best: number, v: number, i: number) =>
      Math.abs(v - m.wacc) < Math.abs(m.wR[best] - m.wacc) ? i : best
    , 0) ?? 0;

  const tgrBaseCol =
    m?.gR?.reduce((best: number, v: number, i: number) =>
      Math.abs(v - a.tgr) < Math.abs(m.gR[best] - a.tgr) ? i : best
    , 0) ?? 0;

  const setArrayValue = (key: string, i: number, v: number) => {
    const base = a[key] || Array(5).fill(0);
    const next = [...base];
    next[i] = v;
    ua(key, next);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(0,229,176,0.13), transparent 30%), radial-gradient(circle at top right, rgba(0,163,255,0.16), transparent 35%), linear-gradient(180deg, #070914 0%, #090b13 45%, #05060b 100%)",
        fontFamily: "'Pretendard','IBM Plex Sans KR',sans-serif",
        color: COLORS.text,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans+KR:wght@400;500;600;700;800;900&display=swap');

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        ::-webkit-scrollbar {
          height: 6px;
          width: 6px;
        }

        ::-webkit-scrollbar-thumb {
          background: rgba(130,150,180,0.22);
          border-radius: 99px;
        }

        ::-webkit-scrollbar-track {
          background: transparent;
        }

        input::placeholder {
          color: #4e5c70;
        }

        button:hover {
          opacity: 0.86;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes pulseGlow {
          0%, 100% {
            box-shadow: 0 0 18px rgba(0,229,176,0.25);
          }
          50% {
            box-shadow: 0 0 34px rgba(0,163,255,0.35);
          }
        }
      `}</style>

      <div
        style={{
          padding: "16px 22px",
          borderBottom: `1px solid ${COLORS.border}`,
          background:
            "linear-gradient(90deg, rgba(9,12,26,0.94), rgba(12,18,34,0.78))",
          backdropFilter: "blur(18px)",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          position: "sticky",
          top: 0,
          zIndex: 20,
          boxShadow: "0 14px 38px rgba(0,0,0,0.25)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              background:
                "linear-gradient(135deg, #00e5b0 0%, #00a3ff 55%, #6d5dfc 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 950,
              color: "#050816",
              boxShadow: "0 0 24px rgba(0,210,160,0.30)",
              animation: "pulseGlow 3.5s ease-in-out infinite",
            }}
          >
            FIS
          </div>

          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 900,
                letterSpacing: -0.3,
                color: "#f5f7fb",
              }}
            >
              FIS Valuation Lab
            </div>
            <div
              style={{
                fontSize: 8,
                color: "#73819a",
                letterSpacing: 1.25,
                marginTop: 1,
              }}
            >
              KAU BUSINESS · RESEARCH TEAM
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flex: 1, maxWidth: 520 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="기업명 입력: 삼성전자, SK하이닉스, 현대자동차, NAVER"
            style={{
              flex: 1,
              padding: "11px 14px",
              borderRadius: 12,
              border: "1px solid rgba(110,130,170,0.18)",
              background: "rgba(8,12,24,0.72)",
              color: "#fff",
              fontSize: 12,
              outline: "none",
              fontFamily: "'IBM Plex Mono', 'Pretendard', sans-serif",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.02)",
            }}
          />

          <button
            onClick={go}
            disabled={loading}
            style={{
              padding: "11px 23px",
              borderRadius: 12,
              border: "none",
              background: loading
                ? "#1a1a2e"
                : "linear-gradient(135deg,#00e5b0,#00a3ff)",
              color: loading ? "#444" : "#031016",
              fontSize: 12,
              fontWeight: 950,
              cursor: loading ? "default" : "pointer",
              fontFamily: "inherit",
              boxShadow: loading ? "none" : "0 8px 26px rgba(0,163,255,0.28)",
            }}
          >
            {loading ? "분석중..." : "분석"}
          </button>
        </div>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 8,
            alignItems: "center",
            color: COLORS.dim,
            fontSize: 10,
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: COLORS.green,
              boxShadow: "0 0 12px rgba(0,229,176,0.8)",
            }}
          />
          LIVE RESEARCH MODE
        </div>
      </div>

      {loading && (
        <div style={{ padding: 58, textAlign: "center" }}>
          <div
            style={{
              width: 38,
              height: 38,
              border: "3px solid rgba(255,255,255,0.06)",
              borderTopColor: COLORS.green,
              borderRightColor: COLORS.blue,
              borderRadius: "50%",
              margin: "0 auto 14px",
              animation: "spin 0.8s linear infinite",
            }}
          />

          <div style={{ color: COLORS.green, fontSize: 12, fontWeight: 700 }}>
            {prog}
          </div>
        </div>
      )}

      {err && (
        <div
          style={{
            margin: "24px 18px",
            padding: 18,
            borderRadius: 16,
            border: "1px solid rgba(255,107,107,0.22)",
            background: "rgba(255,107,107,0.06)",
            color: COLORS.red,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {err}
        </div>
      )}

      {!loading && !d && !err && <Landing />}

      {d && m && a && (
        <div>
          <div
            style={{
              margin: "18px 18px 0",
              padding: "17px 19px",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 18,
              background:
                "linear-gradient(135deg, rgba(13,18,34,0.94), rgba(8,12,24,0.76))",
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              flexWrap: "wrap",
              fontSize: 12,
              boxShadow: "0 18px 52px rgba(0,0,0,0.26)",
            }}
          >
            <span
              style={{
                fontSize: 20,
                fontWeight: 950,
                color: "#f5f7fb",
                letterSpacing: -0.6,
              }}
            >
              {d.company}
            </span>

            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                background: "rgba(0,163,255,0.08)",
                border: "1px solid rgba(0,163,255,0.18)",
                color: "#80ceff",
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 10,
              }}
            >
              {d.ticker}
            </span>

            <span
              style={{
                color: COLORS.green,
                fontWeight: 900,
                fontSize: 14,
              }}
            >
              {fmt(d.price)}원 현재가
            </span>

            <span
              style={{
                color: COLORS.dim,
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 10,
              }}
            >
              Yahoo: {d.yahooSymbol || "-"}
            </span>

            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                background: "rgba(0,229,176,0.07)",
                border: "1px solid rgba(0,229,176,0.16)",
                color: "#9debd9",
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              산업: {d.industry?.name || "-"}
            </span>

            <span
              style={{
                marginLeft: "auto",
                fontWeight: 900,
                color: m.blended > d.price ? COLORS.green : COLORS.red,
                fontSize: 14,
              }}
            >
              종합 목표주가 {fmt(Math.round(m.blended))}원 (
              {m.blended > d.price ? "+" : ""}
              {upside}%)
            </span>
          </div>

          <div
            style={{
              display: "flex",
              margin: "12px 18px 0",
              padding: "0 10px",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 16,
              background: "rgba(8,12,24,0.58)",
              overflowX: "auto",
              backdropFilter: "blur(14px)",
              boxShadow: "0 14px 40px rgba(0,0,0,0.18)",
            }}
          >
            {TABS.map((t, i) => (
              <button
                key={i}
                onClick={() => setTab(i)}
                style={{
                  padding: "12px 13px",
                  border: "none",
                  background: "transparent",
                  color: tab === i ? COLORS.green : "#59667a",
                  fontSize: 11,
                  fontWeight: tab === i ? 900 : 600,
                  cursor: "pointer",
                  borderBottom:
                    tab === i
                      ? `2px solid ${COLORS.green}`
                      : "2px solid transparent",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                  textShadow:
                    tab === i ? "0 0 18px rgba(0,229,176,0.35)" : "none",
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <div style={{ padding: "18px", maxWidth: 1240 }}>
            {tab === 0 && (
              <div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1fr 1fr",
                    gap: 12,
                    marginBottom: 18,
                  }}
                >
                  <StatCard
                    label="산업군"
                    value={d.industry?.name || "-"}
                    sub={`Industry Key: ${d.industry?.key || "-"}`}
                  />
                  <StatCard
                    label="산업 평균 PER"
                    value={d.industry?.avgPER ? mult(d.industry.avgPER) : "-"}
                    sub="동종기업 Yahoo/DART 기반"
                  />
                  <StatCard
                    label="산업 평균 PBR"
                    value={d.industry?.avgPBR ? mult(d.industry.avgPBR) : "-"}
                    sub="동종기업 Yahoo/DART 기반"
                  />
                  <StatCard
                    label="컨센서스"
                    value={a.use_consensus ? "반영 중" : "미반영"}
                    sub="추정 수정 탭에서 직접 입력 가능"
                  />
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 16,
                    marginBottom: 18,
                  }}
                >
                  <InfoCard
                    title="산업 특성"
                    items={d.industry?.characteristics || []}
                  />
                  <InfoCard
                    title="가치평가 핵심 변수"
                    items={d.industry?.valuationDrivers || []}
                  />
                  <InfoCard title="산업 이슈" items={d.industry?.issues || []} />
                </div>

                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 900,
                    color: "#d6e3f4",
                    marginBottom: 9,
                  }}
                >
                  동종 산업군 타 기업 목록
                </div>

                <T
                  headers={["기업명", "종목코드", "현재가", "PER", "PBR", "시가총액"]}
                  rows={(d.industry?.peers || []).map((p: any) => [
                    p.name,
                    p.ticker,
                    p.price,
                    p.per,
                    p.pbr,
                    p.marketCap,
                  ])}
                  formats={[
                    (v: any) => v,
                    (v: any) => v,
                    (v: any) => (v ? fmt(v) + "원" : "-"),
                    (v: any) => (v ? mult(v) : "-"),
                    (v: any) => (v ? mult(v) : "-"),
                    (v: any) => (v ? fmt(Math.round(v / 100000000)) + "억" : "-"),
                  ]}
                  highlight={() => false}
                />

                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 900,
                    color: "#d6e3f4",
                    margin: "20px 0 9px",
                  }}
                >
                  컨센서스 입력 현황
                </div>

                <T
                  headers={["항목", ...m.fyYears]}
                  rows={[
                    ["매출 컨센서스", ...(a.consensus_revenue || [])],
                    ["영업이익 컨센서스", ...(a.consensus_op || [])],
                    ["순이익 컨센서스", ...(a.consensus_ni || [])],
                  ]}
                  formats={[
                    (v: any) => v,
                    ...m.fyYears.map(() => (v: any) => (v ? fmt(v) : "-")),
                  ]}
                  highlight={(ri: number) => ri === 0 || ri === 1}
                />

                <div
                  style={{
                    fontSize: 10,
                    color: COLORS.muted,
                    lineHeight: 1.6,
                    padding: "0 2px",
                  }}
                >
                  ※ 컨센서스는 현재 무료 안정 API 대신 수동 입력 방식입니다. 값은
                  억원 단위로 입력하면 DCF 추정치에 반영됩니다.
                </div>
              </div>
            )}

            {tab === 1 && (
              <T
                headers={["손익계산서", ...h.years]}
                rows={[
                  ["매출액", ...h.revenue],
                  ["영업이익", ...h.op],
                  ["당기순이익", ...h.ni],
                  ["자산총계", ...h.total_assets],
                  ["자본총계", ...h.total_equity],
                  ["───", ...h.years.map(() => "")],
                  ["영업이익률", ...hMetrics.opm.map((v: number) => pct(v))],
                  [
                    "매출성장률",
                    ...hMetrics.growth.map((v: number | null) =>
                      v == null ? "-" : pct(v)
                    ),
                  ],
                ]}
                formats={[
                  (v: any) => v,
                  ...h.years.map(() => (v: any) =>
                    typeof v === "string" ? v : fmt(v)
                  ),
                ]}
                highlight={(ri: number) => ri === 1 || ri === 2}
              />
            )}

            {tab === 2 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 20,
                }}
              >
                <div
                  style={{
                    padding: 18,
                    borderRadius: 20,
                    background: COLORS.panel,
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 900,
                      color: "#d6e3f4",
                      marginBottom: 12,
                    }}
                  >
                    미래 5년 마진/비용 구조
                  </div>

                  {[
                    ["매출성장률", "rev_growth"],
                    ["매출원가율", "cogs_pct"],
                    ["판관비율", "sga_pct"],
                    ["D&A 비율", "da_pct"],
                    ["CAPEX 비율", "capex_pct"],
                    ["NWC 비율", "nwc_pct"],
                  ].map(([l, k]) => (
                    <div
                      key={k}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        marginBottom: 7,
                      }}
                    >
                      <span
                        style={{
                          width: 100,
                          fontSize: 10,
                          color: COLORS.muted,
                        }}
                      >
                        {l}
                      </span>

                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {a[k].map((v: number, i: number) => (
                          <EC
                            key={i}
                            value={v}
                            onChange={(nv: number) => {
                              const c = [...a[k]];
                              c[i] = nv;
                              ua(k, c);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                  <div
                    style={{
                      marginTop: 20,
                      paddingTop: 16,
                      borderTop: "1px dashed rgba(255,255,255,0.12)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 900,
                          color: "#d6e3f4",
                        }}
                      >
                        컨센서스 직접 입력
                      </div>

                      <button
                        onClick={() => ua("use_consensus", !a.use_consensus)}
                        style={{
                          padding: "7px 10px",
                          borderRadius: 9,
                          border: "1px solid rgba(0,229,176,0.25)",
                          background: a.use_consensus
                            ? "rgba(0,229,176,0.12)"
                            : "#111827",
                          color: a.use_consensus ? COLORS.green : COLORS.muted,
                          fontSize: 10,
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        {a.use_consensus ? "컨센서스 반영 중" : "컨센서스 미반영"}
                      </button>
                    </div>

                    <div
                      style={{
                        fontSize: 10,
                        color: COLORS.muted,
                        marginBottom: 10,
                        lineHeight: 1.55,
                      }}
                    >
                      값은 억원 단위입니다. 0으로 둔 연도는 기존 성장률 가정을
                      사용합니다.
                    </div>

                    {[
                      ["매출", "consensus_revenue"],
                      ["영업이익", "consensus_op"],
                      ["순이익", "consensus_ni"],
                    ].map(([label, key]) => (
                      <div
                        key={key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          marginBottom: 7,
                        }}
                      >
                        <span
                          style={{
                            width: 100,
                            fontSize: 10,
                            color: COLORS.muted,
                          }}
                        >
                          {label}
                        </span>

                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {(a[key] || Array(5).fill(0)).map(
                            (v: number, i: number) => (
                              <EC
                                key={i}
                                value={v}
                                f="num"
                                onChange={(nv: number) =>
                                  setArrayValue(key, i, nv)
                                }
                              />
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    padding: 18,
                    borderRadius: 20,
                    background: COLORS.panel,
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 900,
                      color: "#d6e3f4",
                      marginBottom: 12,
                    }}
                  >
                    CAPM / WACC 세팅
                  </div>

                  {[
                    ["무위험수익률 Rf", "rf", "pct"],
                    ["시장수익률 Rm", "rm", "pct"],
                    ["Beta", "beta", "num"],
                    ["세전 타인자본비용 Kd", "kd", "pct"],
                    ["부채비중 Wd", "debt_weight", "pct"],
                    ["법인세율", "tax_rate", "pct"],
                    ["영구성장률 TGR", "tgr", "pct"],
                  ].map(([label, key, f]) => (
                    <div
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 7,
                      }}
                    >
                      <span
                        style={{
                          width: 136,
                          fontSize: 10,
                          color: COLORS.muted,
                        }}
                      >
                        {label}
                      </span>

                      <EC
                        value={a[key]}
                        onChange={(nv: number) => ua(key, nv)}
                        f={f}
                      />
                    </div>
                  ))}

                  <div
                    style={{
                      marginTop: 14,
                      padding: 14,
                      borderRadius: 14,
                      background:
                        "linear-gradient(135deg, rgba(0,229,176,0.06), rgba(0,163,255,0.05))",
                      border: "1px solid rgba(0,229,176,0.14)",
                      fontSize: 11,
                      color: "#a9b5c6",
                      lineHeight: 1.75,
                    }}
                  >
                    <div>
                      Ke = Rf + Beta × (Rm - Rf) ={" "}
                      <b style={{ color: COLORS.green }}>{pct(m.ke)}</b>
                    </div>
                    <div>
                      WACC = We × Ke + Wd × Kd × (1 - Tax) ={" "}
                      <b style={{ color: COLORS.green }}>{pct(m.wacc)}</b>
                    </div>
                    <div>
                      We = {pct(m.we)} / Wd = {pct(m.wd)}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 16,
                      fontSize: 10,
                      color: COLORS.dim,
                    }}
                  >
                    밸류에이션 비중
                  </div>

                  <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                    {[
                      ["DCF", "w_dcf"],
                      ["PER", "w_per"],
                      ["PBR", "w_pbr"],
                    ].map(([l, k]) => (
                      <div
                        key={k}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <span style={{ fontSize: 10, color: COLORS.muted }}>
                          {l}
                        </span>
                        <EC value={a[k]} onChange={(v: number) => ua(k, v)} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 3 && (
              <T
                headers={["항목", ...m.years]}
                rows={[
                  ["매출액", ...m.rev],
                  ["매출총이익", ...m.gp],
                  ["영업이익", ...m.op],
                  ["당기순이익", ...m.ni],
                  ["───", ...m.years.map(() => "")],
                  ["매출총이익률", ...m.gpm.map((v: number) => pct(v))],
                  ["영업이익률", ...m.opm.map((v: number) => pct(v))],
                  ["순이익률", ...m.npm.map((v: number) => pct(v))],
                ]}
                formats={[
                  (v: any) => v,
                  ...m.years.map(() => (v: any) =>
                    typeof v === "string" ? v : fmt(v)
                  ),
                ]}
                highlight={(ri: number) => ri === 2 || ri === 3}
              />
            )}

            {tab === 4 && (
              <div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  {[
                    ["Ke", pct(m.ke), "Cost of Equity"],
                    ["WACC", pct(m.wacc), "Weighted Avg. Cost of Capital"],
                    ["기업가치 EV", fmt(Math.round(m.ev)) + "억", "Enterprise Value"],
                    ["DCF 목표가", fmt(Math.round(m.targetDCF)) + "원", "DCF Target Price"],
                  ].map(([l, v, s]) => (
                    <StatCard key={l} label={l} value={v} sub={s} />
                  ))}
                </div>

                <T
                  headers={["FCFF", ...m.fyYears]}
                  rows={[
                    ["EBIT", ...m.op.slice(h.years.length)],
                    [
                      "Tax",
                      ...m.op
                        .slice(h.years.length)
                        .map((o: number) => -Math.round(o * a.tax_rate)),
                    ],
                    ["D&A", ...m.da.slice(h.years.length)],
                    [
                      "CAPEX",
                      ...m.rev
                        .slice(h.years.length)
                        .map((r: number, i: number) =>
                          -Math.round(r * a.capex_pct[i])
                        ),
                    ],
                    [
                      "NWC",
                      ...m.rev
                        .slice(h.years.length)
                        .map((r: number, i: number) =>
                          -Math.round(r * a.nwc_pct[i])
                        ),
                    ],
                    ["FCFF", ...m.fcff],
                    ["현재가치 PV", ...m.pvF.map((v: number) => Math.round(v))],
                    [
                      "Terminal Value",
                      ...m.fyYears.map((_: any, i: number) =>
                        i === m.fyYears.length - 1 ? Math.round(m.tv) : ""
                      ),
                    ],
                    [
                      "PV of TV",
                      ...m.fyYears.map((_: any, i: number) =>
                        i === m.fyYears.length - 1 ? Math.round(m.pvTv) : ""
                      ),
                    ],
                  ]}
                  formats={[
                    (v: any) => v,
                    ...m.fyYears.map(() => (v: any) =>
                      typeof v === "string" ? v : fmt(v)
                    ),
                  ]}
                  highlight={(ri: number) => ri === 5 || ri === 6}
                />
              </div>
            )}

            {tab === 5 && (
              <div>
                <div
                  style={{
                    padding: "13px 15px",
                    borderRadius: 16,
                    background: "rgba(0,163,255,0.055)",
                    border: "1px solid rgba(0,163,255,0.16)",
                    marginBottom: 16,
                    fontSize: 11,
                    color: "#8fd5ff",
                    lineHeight: 1.55,
                  }}
                >
                  동종기업 PER/PBR은 산업 분석에서 자동 수집한 값을 기본으로
                  가져옵니다. 필요하면 직접 수정하세요.
                </div>

                <div style={{ marginBottom: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 900,
                        color: "#d6e3f4",
                      }}
                    >
                      비교군 Peer Group 설정
                    </div>

                    <button
                      onClick={() =>
                        ua("peers", [
                          ...(a.peers || []),
                          { name: "새 기업", per: 10, pbr: 1.0 },
                        ])
                      }
                      style={{
                        padding: "7px 10px",
                        background: "rgba(0,229,176,0.08)",
                        border: "1px solid rgba(0,229,176,0.24)",
                        color: COLORS.green,
                        borderRadius: 10,
                        fontSize: 10,
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      + 추가
                    </button>
                  </div>

                  <div
                    style={{
                      overflowX: "auto",
                      borderRadius: 16,
                      border: `1px solid ${COLORS.border}`,
                      background: COLORS.panel2,
                    }}
                  >
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 11,
                        fontFamily: "'IBM Plex Mono',monospace",
                      }}
                    >
                      <thead>
                        <tr>
                          {["기업명", "Target PER", "Target PBR", "관리"].map(
                            (x, i) => (
                              <th
                                key={x}
                                style={{
                                  padding: "9px 10px",
                                  background: "#10182b",
                                  color: COLORS.muted,
                                  textAlign:
                                    i === 0 ? "left" : i === 3 ? "center" : "right",
                                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                                }}
                              >
                                {x}
                              </th>
                            )
                          )}
                        </tr>
                      </thead>

                      <tbody>
                        {a.peers?.map((p: any, i: number) => (
                          <tr
                            key={i}
                            style={{
                              borderBottom: "1px solid rgba(255,255,255,0.035)",
                            }}
                          >
                            <td style={{ padding: "8px 10px" }}>
                              <input
                                value={p.name}
                                onChange={(e) => {
                                  const np = [...a.peers];
                                  np[i].name = e.target.value;
                                  ua("peers", np);
                                }}
                                style={{
                                  width: 160,
                                  padding: "6px 8px",
                                  background: "rgba(0,163,255,0.08)",
                                  border: "1px dashed rgba(0,163,255,0.25)",
                                  borderRadius: 8,
                                  color: "#8fd5ff",
                                  fontSize: 11,
                                  outline: "none",
                                  fontFamily: "inherit",
                                }}
                              />
                            </td>

                            <td style={{ padding: "8px 10px", textAlign: "right" }}>
                              <EC
                                value={p.per}
                                f="num"
                                onChange={(v: number) => {
                                  const np = [...a.peers];
                                  np[i].per = v;
                                  ua("peers", np);
                                }}
                              />
                            </td>

                            <td style={{ padding: "8px 10px", textAlign: "right" }}>
                              <EC
                                value={p.pbr}
                                f="num"
                                onChange={(v: number) => {
                                  const np = [...a.peers];
                                  np[i].pbr = v;
                                  ua("peers", np);
                                }}
                              />
                            </td>

                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <button
                                onClick={() => {
                                  const np = a.peers.filter(
                                    (_: any, idx: number) => idx !== i
                                  );
                                  ua("peers", np);
                                }}
                                style={{
                                  background: "rgba(255,107,107,0.08)",
                                  border: "1px solid rgba(255,107,107,0.18)",
                                  color: COLORS.red,
                                  cursor: "pointer",
                                  fontSize: 10,
                                  borderRadius: 8,
                                  padding: "5px 8px",
                                  fontWeight: 800,
                                }}
                              >
                                삭제
                              </button>
                            </td>
                          </tr>
                        ))}

                        <tr style={{ background: "rgba(0,229,176,0.055)" }}>
                          <td
                            style={{
                              padding: "10px",
                              fontWeight: 900,
                              color: COLORS.green,
                            }}
                          >
                            평균 Average
                          </td>
                          <td
                            style={{
                              padding: "10px",
                              textAlign: "right",
                              fontWeight: 900,
                              color: COLORS.green,
                            }}
                          >
                            {m.avgPER.toFixed(1)}x
                          </td>
                          <td
                            style={{
                              padding: "10px",
                              textAlign: "right",
                              fontWeight: 900,
                              color: COLORS.green,
                            }}
                          >
                            {m.avgPBR.toFixed(1)}x
                          </td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div
                  style={{
                    padding: 18,
                    borderRadius: 20,
                    background:
                      "linear-gradient(135deg,rgba(0,229,176,0.055),rgba(0,163,255,0.055))",
                    border: "1px solid rgba(0,229,176,0.15)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 16,
                      borderBottom: "1px dashed rgba(255,255,255,0.12)",
                      paddingBottom: 14,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 900,
                        color: "#f5f7fb",
                      }}
                    >
                      타겟 기업 프리미엄 / 할인율:
                    </span>

                    <EC
                      value={a.premium_pct}
                      f="pct"
                      onChange={(v: number) => ua("premium_pct", v)}
                    />

                    <span style={{ fontSize: 10, color: COLORS.muted }}>
                      예: 20% 할증이면 20 입력
                    </span>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 16,
                    }}
                  >
                    <StatCard
                      label={`적용 PER ${(m.avgPER * (1 + a.premium_pct)).toFixed(
                        1
                      )}x`}
                      value={`${fmt(Math.round(m.tPER))}원`}
                      sub="PER 목표가"
                    />
                    <StatCard
                      label={`적용 PBR ${(m.avgPBR * (1 + a.premium_pct)).toFixed(
                        1
                      )}x`}
                      value={`${fmt(Math.round(m.tPBR))}원`}
                      sub="PBR 목표가"
                    />
                    <StatCard
                      label="DCF/PER/PBR 가중 평균"
                      value={`${fmt(Math.round(m.blended))}원`}
                      sub="종합 목표가"
                    />
                  </div>
                </div>
              </div>
            )}

            {tab === 6 && (
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 900,
                    color: "#d6e3f4",
                    marginBottom: 10,
                  }}
                >
                  WACC × TGR 민감도 분석
                </div>

                <Mx
                  rL={m.wR}
                  cL={m.gR}
                  data={m.sensM}
                  rF={(v: number) => pct(v)}
                  cF={(v: number) => pct(v)}
                  cFmt={(v: number) => fmt(v)}
                  bR={waccBaseRow}
                  bC={tgrBaseCol}
                />

                <div style={{ fontSize: 10, color: COLORS.muted }}>
                  현재 계산 WACC: {pct(m.wacc)} / TGR: {pct(a.tgr)}
                </div>
              </div>
            )}

            {tab === 7 && (
              <div>
                <StockAppChart symbol={d.yahooSymbol} company={d.company} />

                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 900,
                    color: "#d6e3f4",
                    margin: "22px 0 10px",
                  }}
                >
                  과거 WACC 추정 추이
                </div>

                <MiniLine
                  data={h.years.map((y: string, i: number) => ({
                    date: y,
                    wacc: m.waccTrend[i],
                  }))}
                  xKey="date"
                  yKey="wacc"
                  yFmt={(v: number) => pct(v)}
                />

                <T
                  headers={["항목", ...h.years]}
                  rows={[
                    ["추정 WACC", ...m.waccTrend.map((v: number) => pct(v))],
                    ["자산총계", ...h.total_assets],
                    ["자본총계", ...h.total_equity],
                    [
                      "부채 Proxy",
                      ...h.total_assets.map(
                        (v: number, i: number) => v - h.total_equity[i]
                      ),
                    ],
                  ]}
                  formats={[
                    (v: any) => v,
                    ...h.years.map(() => (v: any) =>
                      typeof v === "string" ? v : fmt(v)
                    ),
                  ]}
                  highlight={(ri: number) => ri === 0}
                />

                <div style={{ fontSize: 10, color: COLORS.muted, lineHeight: 1.6 }}>
                  ※ 과거 WACC는 실제 과거 금리와 베타를 수집한 값이 아니라,
                  현재 입력한 Rf, Rm, Beta, Kd를 기준으로 과거 자본구조만
                  반영한 추정치입니다.
                </div>
              </div>
            )}

            {tab === 8 && (
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 900,
                    color: "#d6e3f4",
                    marginBottom: 12,
                  }}
                >
                  {d.company} 관련 최신 뉴스
                </div>

                {(!d.news || d.news.length === 0) && (
                  <div
                    style={{
                      fontSize: 12,
                      color: COLORS.muted,
                      padding: 18,
                      borderRadius: 16,
                      border: `1px solid ${COLORS.border}`,
                      background: COLORS.panel,
                    }}
                  >
                    뉴스를 가져오지 못했습니다.
                  </div>
                )}

                <div style={{ display: "grid", gap: 10 }}>
                  {d.news?.map((n: any, i: number) => (
                    <a
                      key={i}
                      href={n.link}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "block",
                        padding: "13px 15px",
                        borderRadius: 16,
                        background:
                          "linear-gradient(135deg, rgba(13,18,34,0.86), rgba(8,12,24,0.70))",
                        border: `1px solid ${COLORS.border}`,
                        textDecoration: "none",
                        color: COLORS.text,
                        boxShadow: "0 14px 36px rgba(0,0,0,0.16)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          marginBottom: 6,
                          lineHeight: 1.5,
                          color: "#e6edf7",
                        }}
                      >
                        {n.title}
                      </div>

                      <div
                        style={{
                          fontSize: 10,
                          color: COLORS.muted,
                          fontFamily: "'IBM Plex Mono', monospace",
                        }}
                      >
                        {n.source || "Google News"} · {n.date || "-"}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}