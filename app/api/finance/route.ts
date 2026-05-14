import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CorpTarget = {
  dart: string;
  stock: string;
};

type IndustryBase = {
  key: string;
  name: string;
  characteristics: string[];
  valuationDrivers: string[];
  issues: string[];
  peerNames: string[];
};

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};

function normalizeName(s: string) {
  return String(s || "")
    .replace(/\s/g, "")
    .toLowerCase();
}

function findCorp(corpMap: Record<string, CorpTarget>, query: string) {
  if (corpMap[query]) {
    return {
      name: query,
      target: corpMap[query],
    };
  }

  const nq = normalizeName(query);

  const key = Object.keys(corpMap).find((k) => normalizeName(k) === nq);

  if (!key) return null;

  return {
    name: key,
    target: corpMap[key],
  };
}

function decodeXml(s = "") {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getTag(block: string, tag: string) {
  const m = block.match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
  );

  return m ? decodeXml(m[1].trim()) : "";
}

function cleanAmount(v: any) {
  if (v == null) return 0;

  const raw = String(v).trim();

  const isNegative = raw.includes("(") && raw.includes(")");

  const s = raw
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .replace(/[()]/g, "");

  const n = Number(s);

  if (!Number.isFinite(n)) return 0;

  return isNegative ? -n : n;
}

function toEok(v: any) {
  return Math.round(cleanAmount(v) / 100000000);
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: YAHOO_HEADERS,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`외부 데이터 호출 실패: HTTP ${res.status}`);
  }

  return res.json();
}

async function testYahooSymbol(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=5d&interval=1d`;

  const data = await fetchJson(url);
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;

  const closes =
    result?.indicators?.quote?.[0]?.close?.filter(
      (v: any) => typeof v === "number"
    ) || [];

  const price = meta?.regularMarketPrice || closes[closes.length - 1] || 0;

  if (!price) return null;

  return {
    symbol,
    price,
    currency: meta?.currency || "KRW",
  };
}

async function resolveYahooSymbol(stockCode: string) {
  const candidates = [`${stockCode}.KS`, `${stockCode}.KQ`, stockCode];

  for (const symbol of candidates) {
    try {
      const result = await testYahooSymbol(symbol);

      if (result) return result;
    } catch {
      // 다음 후보 시도
    }
  }

  return {
    symbol: `${stockCode}.KS`,
    price: 0,
    currency: "KRW",
  };
}

async function getYahooMarketData(stockCode: string, includeHistory = true) {
  const resolved = await resolveYahooSymbol(stockCode);
  const symbol = resolved.symbol;

  let price = resolved.price || 0;
  let sharesMil = 0;
  let marketCap = 0;
  let per = 0;
  let pbr = 0;

  try {
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
      symbol
    )}`;

    const quoteData = await fetchJson(quoteUrl);
    const q = quoteData?.quoteResponse?.result?.[0];

    if (q) {
      price =
        q.regularMarketPrice ||
        q.postMarketPrice ||
        q.preMarketPrice ||
        price ||
        0;

      marketCap = q.marketCap || 0;
      per = q.trailingPE || q.forwardPE || 0;
      pbr = q.priceToBook || 0;

      if (q.sharesOutstanding) {
        sharesMil = q.sharesOutstanding / 1000000;
      } else if (marketCap && price) {
        sharesMil = marketCap / price / 1000000;
      }
    }
  } catch {
    // chart 가격이라도 사용
  }

  let priceHistory: { date: string; close: number }[] = [];

  if (includeHistory) {
    try {
      const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol
      )}?range=1y&interval=1d`;

      const chartData = await fetchJson(chartUrl);
      const result = chartData?.chart?.result?.[0];

      const timestamps: number[] = result?.timestamp || [];
      const closes: number[] = result?.indicators?.quote?.[0]?.close || [];

      priceHistory = timestamps
        .map((t, i) => ({
          date: new Date(t * 1000).toISOString().slice(0, 10),
          close: closes[i],
        }))
        .filter((x) => typeof x.close === "number" && Number.isFinite(x.close));
    } catch {
      priceHistory = [];
    }
  }

  return {
    yahooSymbol: symbol,
    price,
    sharesMil,
    marketCap,
    per,
    pbr,
    priceHistory,
  };
}

async function getDartCompanyInfo(apiKey: string, corpCode: string) {
  try {
    const url = `https://opendart.fss.or.kr/api/company.json?crtfc_key=${apiKey}&corp_code=${corpCode}`;

    const res = await fetch(url, {
      cache: "no-store",
    });

    const json = await res.json();

    if (json?.status !== "000") return null;

    return json;
  } catch {
    return null;
  }
}

async function getDartAnnual(apiKey: string, corpCode: string, year: string) {
  const url =
    `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json` +
    `?crtfc_key=${apiKey}` +
    `&corp_code=${corpCode}` +
    `&bsns_year=${year}` +
    `&reprt_code=11011`;

  const res = await fetch(url, {
    cache: "no-store",
  });

  return res.json();
}

async function getDartSharesOutstanding(
  apiKey: string,
  corpCode: string,
  year: string
) {
  try {
    const url =
      `https://opendart.fss.or.kr/api/stockTotqySttus.json` +
      `?crtfc_key=${apiKey}` +
      `&corp_code=${corpCode}` +
      `&bsns_year=${year}` +
      `&reprt_code=11011`;

    const res = await fetch(url, {
      cache: "no-store",
    });

    const json = await res.json();

    if (json?.status !== "000" || !json?.list?.length) return 0;

    const rows = json.list;

    const common =
      rows.find((x: any) => String(x.se || "").includes("보통주")) ||
      rows.find((x: any) => String(x.se || "").includes("합계")) ||
      rows[0];

    const candidates = [
      common.istc_totqy,
      common.isu_stock_totqy,
      common.now_to_isu_stock_totqy,
      common.distb_stock_co,
      common.distb_stock_totqy,
      common.totqy,
    ];

    for (const c of candidates) {
      const n = cleanAmount(c);

      if (n > 1000000) return n;
    }

    for (const value of Object.values(common)) {
      const n = cleanAmount(value);

      if (n > 1000000) return n;
    }

    return 0;
  } catch {
    return 0;
  }
}

function pickAmount(list: any[], names: string[]) {
  const preferred = list.find(
    (x) =>
      x.fs_div === "CFS" &&
      names.some((n) => String(x.account_nm || "").includes(n))
  );

  const fallback = list.find((x) =>
    names.some((n) => String(x.account_nm || "").includes(n))
  );

  return toEok((preferred || fallback)?.thstrm_amount);
}

function classifyIndustry(
  companyName: string,
  stockCode: string,
  indutyCode?: string
): IndustryBase {
  const name = String(companyName || "")
    .replace(/\s/g, "")
    .toUpperCase();

  const code = String(stockCode || "").trim();

  if (
    code === "005930" ||
    code === "000660" ||
    code === "000990" ||
    code === "042700" ||
    code === "058470" ||
    code === "036930" ||
    name.includes("삼성전자") ||
    name.includes("SK하이닉스") ||
    name.includes("DB하이텍") ||
    name.includes("한미반도체") ||
    name.includes("리노공업") ||
    name.includes("ISC")
  ) {
    return {
      key: "semiconductor",
      name: "반도체",
      characteristics: [
        "메모리 가격과 재고 사이클에 따라 실적 변동성이 큽니다.",
        "CAPEX와 감가상각비 비중이 높아 업황 회복 시 영업레버리지가 크게 나타납니다.",
        "AI 서버, 데이터센터, 스마트폰, PC 수요가 핵심 매출 동인입니다.",
      ],
      valuationDrivers: [
        "DRAM/NAND 가격",
        "HBM 및 AI 메모리 수요",
        "CAPEX 사이클",
        "환율",
        "재고 수준",
        "미중 반도체 규제",
      ],
      issues: [
        "AI 반도체 수요 확대",
        "메모리 가격 반등 여부",
        "HBM 경쟁력",
        "중국향 수출 규제",
      ],
      peerNames: ["SK하이닉스", "DB하이텍", "한미반도체", "리노공업", "ISC"],
    };
  }

  if (
    code === "005380" ||
    code === "000270" ||
    code === "012330" ||
    code === "204320" ||
    name.includes("현대자동차") ||
    name.includes("현대차") ||
    name.includes("기아") ||
    name.includes("현대모비스") ||
    name.includes("HL만도") ||
    name.includes("만도")
  ) {
    return {
      key: "auto",
      name: "자동차 / 자동차부품",
      characteristics: [
        "글로벌 경기와 소비 심리에 민감한 내구재 산업입니다.",
        "환율, 원재료 가격, 인건비, 판매 인센티브가 수익성에 큰 영향을 줍니다.",
        "전기차, 하이브리드, 자율주행, 소프트웨어 경쟁력이 장기 밸류에이션에 반영됩니다.",
      ],
      valuationDrivers: [
        "글로벌 판매량",
        "ASP",
        "환율",
        "전기차·하이브리드 믹스",
        "판매 인센티브",
        "원재료 가격",
      ],
      issues: [
        "전기차 수요 둔화 여부",
        "하이브리드 판매 확대",
        "미국 시장 점유율",
        "환율 효과",
      ],
      peerNames: ["기아", "현대모비스", "HL만도"],
    };
  }

  if (
    code === "035420" ||
    code === "035720" ||
    code === "012510" ||
    code === "036570" ||
    code === "259960" ||
    name.includes("NAVER") ||
    name.includes("네이버") ||
    name.includes("카카오") ||
    name.includes("더존비즈온") ||
    name.includes("엔씨소프트") ||
    name.includes("크래프톤")
  ) {
    return {
      key: "internet_platform",
      name: "인터넷 플랫폼 / 소프트웨어",
      characteristics: [
        "광고, 커머스, 콘텐츠, 클라우드 등 플랫폼 매출 비중이 중요합니다.",
        "매출 성장률과 영업이익률 개선 가능성이 밸류에이션 핵심입니다.",
        "AI, 검색 경쟁력, 클라우드 투자, 규제 이슈가 투자심리에 큰 영향을 줍니다.",
      ],
      valuationDrivers: [
        "광고 성장률",
        "커머스 거래액",
        "콘텐츠 매출",
        "AI 투자비",
        "클라우드 매출",
        "규제 리스크",
      ],
      issues: [
        "AI 검색 경쟁",
        "광고 경기 회복",
        "플랫폼 규제",
        "커머스 성장 둔화 여부",
      ],
      peerNames: ["카카오", "더존비즈온", "엔씨소프트", "크래프톤"],
    };
  }

  if (
    code === "373220" ||
    code === "006400" ||
    code === "003670" ||
    code === "247540" ||
    code === "066970" ||
    name.includes("LG에너지솔루션") ||
    name.includes("삼성SDI") ||
    name.includes("포스코퓨처엠") ||
    name.includes("에코프로") ||
    name.includes("엘앤에프")
  ) {
    return {
      key: "battery",
      name: "2차전지 / 배터리 소재",
      characteristics: [
        "전기차 수요, 배터리 판가, 원재료 가격에 민감합니다.",
        "증설 투자 규모가 크고 가동률 변화가 수익성에 큰 영향을 줍니다.",
        "고객사 수주, IRA 등 정책, 중국 경쟁사의 가격 경쟁이 중요합니다.",
      ],
      valuationDrivers: [
        "전기차 판매량",
        "배터리 판가",
        "리튬·니켈 가격",
        "수주잔고",
        "가동률",
        "정책 보조금",
      ],
      issues: [
        "전기차 수요 둔화 여부",
        "배터리 가격 하락",
        "중국 업체와의 경쟁",
        "미국 IRA 수혜 여부",
      ],
      peerNames: ["LG에너지솔루션", "삼성SDI", "포스코퓨처엠", "에코프로비엠", "엘앤에프"],
    };
  }

  if (
    code === "068270" ||
    code === "207940" ||
    code === "000100" ||
    code === "128940" ||
    name.includes("셀트리온") ||
    name.includes("삼성바이오로직스") ||
    name.includes("유한양행") ||
    name.includes("한미약품")
  ) {
    return {
      key: "bio_pharma",
      name: "바이오 / 제약",
      characteristics: [
        "신약 파이프라인, 임상 결과, 허가 일정이 기업가치에 큰 영향을 줍니다.",
        "일반 제조업보다 이익 변동성이 크고 R&D 비용 비중이 높습니다.",
        "바이오시밀러, CMO, 전문의약품 등 세부 사업모델별 밸류에이션 방식이 다릅니다.",
      ],
      valuationDrivers: [
        "임상 결과",
        "파이프라인 가치",
        "R&D 비용",
        "CMO 수주",
        "약가 규제",
        "수출 성장률",
      ],
      issues: [
        "신약 허가 및 임상 이벤트",
        "바이오시밀러 경쟁 심화",
        "미국 FDA 승인 일정",
        "R&D 비용 부담",
      ],
      peerNames: ["셀트리온", "삼성바이오로직스", "유한양행", "한미약품"],
    };
  }

  if (
    code === "105560" ||
    code === "055550" ||
    code === "086790" ||
    code === "316140" ||
    code === "024110" ||
    name.includes("KB금융") ||
    name.includes("신한지주") ||
    name.includes("하나금융지주") ||
    name.includes("우리금융지주") ||
    name.includes("기업은행")
  ) {
    return {
      key: "financial",
      name: "은행 / 금융지주",
      characteristics: [
        "순이자마진, 대손비용, 자본비율, 주주환원 정책이 핵심입니다.",
        "일반적으로 PER보다 PBR과 ROE 중심의 밸류에이션이 많이 사용됩니다.",
        "금리 방향성과 부동산 PF, 연체율이 투자심리에 영향을 줍니다.",
      ],
      valuationDrivers: [
        "순이자마진 NIM",
        "ROE",
        "CET1 비율",
        "대손비용",
        "배당성향",
        "자사주 매입",
      ],
      issues: [
        "금리 인하 여부",
        "대손비용 증가",
        "주주환원 확대",
        "부동산 PF 리스크",
      ],
      peerNames: ["KB금융", "신한지주", "하나금융지주", "우리금융지주", "기업은행"],
    };
  }

  if (
    code === "005490" ||
    code === "004020" ||
    code === "010130" ||
    code === "460860" ||
    name.includes("POSCO") ||
    name.includes("포스코") ||
    name.includes("현대제철") ||
    name.includes("고려아연") ||
    name.includes("동국제강")
  ) {
    return {
      key: "materials",
      name: "철강 / 소재",
      characteristics: [
        "글로벌 경기, 중국 수요, 원재료 가격에 민감한 경기순환 산업입니다.",
        "판가와 원가 스프레드가 영업이익률을 좌우합니다.",
        "탄소규제, 전기로 전환, 배터리 소재 사업 확장 여부가 장기 밸류에이션에 반영됩니다.",
      ],
      valuationDrivers: [
        "철강 가격",
        "원재료 가격",
        "중국 수요",
        "스프레드",
        "환율",
        "탄소규제",
      ],
      issues: [
        "중국 경기 회복 여부",
        "철강 가격 반등",
        "원재료 가격 변동",
        "배터리 소재 사업 가치",
      ],
      peerNames: ["POSCO홀딩스", "현대제철", "고려아연", "동국제강"],
    };
  }

  return {
    key: "general",
    name: indutyCode ? `일반 산업 / 업종코드 ${indutyCode}` : "일반 산업",
    characteristics: [
      "매출 성장률, 영업이익률, 자본효율성, 재무구조를 중심으로 분석해야 합니다.",
      "동종기업 대비 PER, PBR, ROE 수준을 함께 비교하는 것이 중요합니다.",
      "산업 특성이 자동 분류되지 않은 경우 Peer Group을 직접 수정해 분석 정확도를 높일 수 있습니다.",
    ],
    valuationDrivers: [
      "매출 성장률",
      "영업이익률",
      "ROE",
      "순부채",
      "현금흐름",
      "동종기업 밸류에이션",
    ],
    issues: [
      "실적 성장 지속 가능성",
      "마진 개선 여부",
      "재무구조 안정성",
      "동종기업 대비 밸류에이션 매력",
    ],
    peerNames: [],
  };
}

async function getPeerValuation(
  peerNames: string[],
  corpMap: Record<string, CorpTarget>,
  apiKey: string,
  latestYear: string,
  excludeName: string
) {
  const uniqueNames = [...new Set(peerNames)].filter(
    (name) => name && normalizeName(name) !== normalizeName(excludeName)
  );

  const peers = [];

  for (const name of uniqueNames) {
    const found = findCorp(corpMap, name);

    if (!found) continue;

    try {
      const target = found.target;
      const market = await getYahooMarketData(target.stock, false);

      let per = Number(market.per || 0);
      let pbr = Number(market.pbr || 0);

      let sharesMil = Number(market.sharesMil || 0);

      if (!sharesMil) {
        const dartShares = await getDartSharesOutstanding(
          apiKey,
          target.dart,
          latestYear
        );

        if (dartShares) sharesMil = dartShares / 1000000;
      }

      if ((!per || !pbr) && market.price && sharesMil) {
        try {
          const annual = await getDartAnnual(apiKey, target.dart, latestYear);

          if (annual.status === "000" && annual.list?.length) {
            const ni = pickAmount(annual.list, ["당기순이익"]);
            const equity = pickAmount(annual.list, ["자본총계"]);

            const eps =
              sharesMil > 0 ? (ni * 100000000) / (sharesMil * 1000000) : 0;

            const bps =
              sharesMil > 0 ? (equity * 100000000) / (sharesMil * 1000000) : 0;

            if (!per && eps > 0) per = market.price / eps;
            if (!pbr && bps > 0) pbr = market.price / bps;
          }
        } catch {
          // peer DART fallback 실패 시 무시
        }
      }

      peers.push({
        name: found.name,
        ticker: target.stock,
        yahooSymbol: market.yahooSymbol,
        price: market.price || 0,
        per: per > 0 && Number.isFinite(per) ? per : 0,
        pbr: pbr > 0 && Number.isFinite(pbr) ? pbr : 0,
        marketCap: market.marketCap || 0,
      });
    } catch {
      peers.push({
        name,
        ticker: "",
        yahooSymbol: "",
        price: 0,
        per: 0,
        pbr: 0,
        marketCap: 0,
      });
    }
  }

  const validPER = peers.filter((p) => Number(p.per) > 0);
  const validPBR = peers.filter((p) => Number(p.pbr) > 0);

  const avgPER = validPER.length
    ? validPER.reduce((s, p) => s + Number(p.per), 0) / validPER.length
    : 0;

  const avgPBR = validPBR.length
    ? validPBR.reduce((s, p) => s + Number(p.pbr), 0) / validPBR.length
    : 0;

  return {
    peers,
    avgPER,
    avgPBR,
  };
}

async function getNews(companyName: string, stockCode: string) {
  try {
    const q = encodeURIComponent(
      `${companyName} ${stockCode} 실적 OR 주가 OR 투자 OR 증권 when:30d`
    );

    const url = `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": YAHOO_HEADERS["User-Agent"],
        Accept: "application/rss+xml,text/xml,*/*",
      },
      cache: "no-store",
    });

    if (!res.ok) return [];

    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

    return items.slice(0, 10).map((m) => {
      const block = m[1];

      return {
        title: getTag(block, "title"),
        source: getTag(block, "source"),
        link: getTag(block, "link"),
        date: getTag(block, "pubDate")
          ? new Date(getTag(block, "pubDate")).toISOString().slice(0, 10)
          : "",
      };
    });
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const { query } = await request.json();
    const searchName = String(query || "").trim();

    if (!searchName) {
      return NextResponse.json(
        { error: "기업명을 입력해주세요." },
        { status: 400 }
      );
    }

    const apiKey = process.env.DART_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "DART_API_KEY가 .env.local에 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    const mapPath = path.join(process.cwd(), "dart_map.json");

    if (!fs.existsSync(mapPath)) {
      return NextResponse.json(
        { error: "기업 DB가 없습니다. /api/init 에 먼저 접속해주세요." },
        { status: 400 }
      );
    }

    const corpMap: Record<string, CorpTarget> = JSON.parse(
      fs.readFileSync(mapPath, "utf-8")
    );

    const found = findCorp(corpMap, searchName);

    if (!found) {
      return NextResponse.json(
        {
          error: `'${searchName}'(으)로 등록된 정확한 상장사명을 찾을 수 없습니다. 예: 삼성전자, SK하이닉스, 현대자동차, NAVER`,
        },
        { status: 404 }
      );
    }

    const companyName = found.name;
    const target = found.target;

    const [market, companyInfo, news] = await Promise.all([
      getYahooMarketData(target.stock, true),
      getDartCompanyInfo(apiKey, target.dart),
      getNews(companyName, target.stock),
    ]);

    const currentYear = new Date().getFullYear();

    const candidateYears = Array.from({ length: 7 }, (_, i) =>
      String(currentYear - 1 - i)
    );

    const financialRows: {
      year: string;
      revenue: number;
      op: number;
      ni: number;
      assets: number;
      equity: number;
    }[] = [];

    for (const year of candidateYears) {
      try {
        const dart = await getDartAnnual(apiKey, target.dart, year);

        if (dart.status === "000" && dart.list?.length) {
          financialRows.push({
            year,
            revenue: pickAmount(dart.list, ["매출액", "수익", "영업수익"]),
            op: pickAmount(dart.list, ["영업이익"]),
            ni: pickAmount(dart.list, ["당기순이익"]),
            assets: pickAmount(dart.list, ["자산총계"]),
            equity: pickAmount(dart.list, ["자본총계"]),
          });
        }
      } catch {
        // 다음 연도 시도
      }

      if (financialRows.length >= 3) break;
    }

    if (financialRows.length < 2) {
      throw new Error("DART 재무 데이터가 부족합니다.");
    }

    financialRows.sort((a, b) => Number(a.year) - Number(b.year));

    const years = financialRows.map((x) => x.year);
    const revenue = financialRows.map((x) => x.revenue);
    const op = financialRows.map((x) => x.op);
    const ni = financialRows.map((x) => x.ni);
    const assets = financialRows.map((x) => x.assets);
    const equity = financialRows.map((x) => x.equity);

    const latestActualYear = Number(years[years.length - 1]);

    const forecastYears = Array.from(
      { length: 5 },
      (_, i) => `${latestActualYear + i + 1}E`
    );

    let sharesMil = Number(market.sharesMil || 0);

    const dartShares = await getDartSharesOutstanding(
      apiKey,
      target.dart,
      String(latestActualYear)
    );

    if (dartShares > 0) {
      sharesMil = dartShares / 1000000;
    }

    if (!sharesMil) sharesMil = 100;

    const industryBase = classifyIndustry(
      companyName,
      target.stock,
      companyInfo?.induty_code
    );

    let peerValuation: {
      peers: any[];
      avgPER: number;
      avgPBR: number;
    } = {
      peers: [],
      avgPER: 0,
      avgPBR: 0,
    };

    try {
      peerValuation = await getPeerValuation(
        industryBase.peerNames,
        corpMap,
        apiKey,
        String(latestActualYear),
        companyName
      );
    } catch {
      peerValuation = {
        peers: [],
        avgPER: 0,
        avgPBR: 0,
      };
    }

    const safeIndustry = {
      ...industryBase,
      peers: peerValuation.peers || [],
      avgPER: peerValuation.avgPER || 0,
      avgPBR: peerValuation.avgPBR || 0,
    };

    const consensus = {
      available: false,
      source: "manual",
      note:
        "무료 안정 API에서 국내 애널리스트 컨센서스를 자동 수집하기 어려워 수동 입력형 컨센서스 테이블로 제공합니다.",
      years: forecastYears,
      revenue: Array(5).fill(0),
      op: Array(5).fill(0),
      ni: Array(5).fill(0),
      eps: Array(5).fill(0),
    };

    const peerAssumptions =
      safeIndustry.peers?.map((p: any) => ({
        name: p.name,
        per: Number(p.per || 0),
        pbr: Number(p.pbr || 0),
      })) || [];

    const modelData = {
      company: companyName,
      searched: searchName,
      ticker: target.stock,
      dartCode: target.dart,
      yahooSymbol: market.yahooSymbol,
      price: market.price,
      shares: sharesMil,
      marketCap: market.marketCap,
      price_history: market.priceHistory,
      news,
      forecast_years: forecastYears,

      company_info: {
        corp_name: companyInfo?.corp_name || companyName,
        stock_name: companyInfo?.stock_name || companyName,
        induty_code: companyInfo?.induty_code || "",
        ceo_nm: companyInfo?.ceo_nm || "",
        adres: companyInfo?.adres || "",
        hm_url: companyInfo?.hm_url || "",
      },

      industry: safeIndustry,

      consensus,

      historical: {
        years: years.map((y) => y + "A"),
        revenue,
        op,
        ni,
        total_assets: assets,
        total_equity: equity,

        cogs: revenue.map((r, i) =>
          Math.max(0, Math.round(r - op[i] - r * 0.1))
        ),
        sga: revenue.map((r) => Math.round(r * 0.1)),
        da: revenue.map((r) => Math.round(r * 0.05)),
        interest: Array(years.length).fill(0),

        eps: ni.map((n) =>
          sharesMil > 0
            ? Math.round((n * 100000000) / (sharesMil * 1000000))
            : 0
        ),
        bps: equity.map((e) =>
          sharesMil > 0
            ? Math.round((e * 100000000) / (sharesMil * 1000000))
            : 0
        ),
      },

      assumptions: {
        rev_growth: [0.05, 0.05, 0.05, 0.03, 0.03],
        cogs_pct: [0.65, 0.65, 0.65, 0.65, 0.65],
        sga_pct: [0.15, 0.15, 0.15, 0.15, 0.15],
        da_pct: [0.05, 0.05, 0.05, 0.05, 0.05],
        tax_rate: 0.22,

        capex_pct: [0.06, 0.06, 0.06, 0.05, 0.05],
        nwc_pct: [0.01, 0.01, 0.01, 0.01, 0.01],

        rf: 0.035,
        rm: 0.085,
        beta: 1.0,
        kd: 0.045,
        debt_weight: 0.25,
        tgr: 0.02,

        use_consensus: false,
        consensus_revenue: consensus.revenue,
        consensus_op: consensus.op,
        consensus_ni: consensus.ni,
        consensus_eps: consensus.eps,

        net_debt: Math.round(assets[assets.length - 1] - equity[equity.length - 1]),

        peers: peerAssumptions,
        premium_pct: 0.0,
      },
    };

    return NextResponse.json({ content: modelData });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "알 수 없는 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}