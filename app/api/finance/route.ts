import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: Request) {
  try {
    const { query } = await request.json();
    const searchName = query.trim();

    // 1. 기업 사전 읽기
    const mapPath = path.join(process.cwd(), 'dart_map.json');
    if (!fs.existsSync(mapPath)) {
      return NextResponse.json({ error: "기업 DB가 없습니다. /api/init 에 먼저 접속해주세요." }, { status: 400 });
    }
    const corpMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
    const target = corpMap[searchName];

    if (!target) {
      return NextResponse.json({ error: `'${searchName}'(으)로 등록된 정확한 상장사명을 찾을 수 없습니다. (예: 현대자동차, SK하이닉스)` }, { status: 404 });
    }

    // 2. 야후 파이낸스 주가 정보
    let livePrice = 0; let sharesMil = 100;
    try {
      const searchRes = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${target.stock}`);
      const searchData = await searchRes.json();
      const ticker = searchData.quotes?.[0]?.symbol || `${target.stock}.KS`;
      
      const yRes = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`);
      const yData = await yRes.json();
      const res = yData.quoteResponse.result[0];
      if (res) {
        livePrice = res.regularMarketPrice || 0;
        sharesMil = res.sharesOutstanding ? res.sharesOutstanding / 1000000 : 100;
      }
    } catch (e) { console.log("주가 호출 실패"); }

    // 3. DART 재무 데이터 호출
    const apiKey = process.env.DART_API_KEY;
    const years = ["2021", "2022", "2023"];
    const fetchPromises = years.map(year => 
      fetch(`https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${apiKey}&corp_code=${target.dart}&bsns_year=${year}&reprt_code=11011`).then(res => res.json())
    );
    const dartResults = await Promise.all(fetchPromises);

    // 뒤에 : any[] 를 붙여서 타입이 '무엇이든 들어올 수 있는 배열'임을 명시합니다.
    const revenue: any[] = []; const op: any[] = []; const ni: any[] = [];
    const assets: any[] = []; const equity: any[] = [];

    for (const res of dartResults) {
      if (res.status !== "000" || !res.list) throw new Error("DART 재무 데이터가 부족합니다.");
      let r = 0, o = 0, n = 0, a = 0, e = 0;
      res.list.forEach((item: any) => {
        if (item.fs_div === 'CFS') { 
          const val = Number(item.thstrm_amount.replace(/,/g, '')) / 100000000;
          if (item.account_nm === '매출액') r = Math.round(val);
          if (item.account_nm === '영업이익') o = Math.round(val);
          if (item.account_nm === '당기순이익') n = Math.round(val);
          if (item.account_nm === '자산총계') a = Math.round(val);
          if (item.account_nm === '자본총계') e = Math.round(val);
        }
      });
      revenue.push(r); op.push(o); ni.push(n); assets.push(a); equity.push(e);
    }

    // 5. 프론트엔드가 기다리는 최종 결과물 조립
    const modelData = {
      company: searchName,
      ticker: target.stock,
      price: livePrice,
      shares: sharesMil,
      historical: {
        years: years.map(y => y + "A"),
        revenue, op, ni, total_assets: assets, total_equity: equity,
        cogs: revenue.map((r, i) => Math.round(r - op[i] - (r * 0.1))),
        sga: revenue.map(r => Math.round(r * 0.1)),
        da: revenue.map(r => Math.round(r * 0.05)),
        interest: [0, 0, 0],
        eps: ni.map(n => sharesMil > 0 ? Math.round((n * 100000000) / (sharesMil * 1000000)) : 0),
        bps: equity.map(e => sharesMil > 0 ? Math.round((e * 100000000) / (sharesMil * 1000000)) : 0),
      },
      assumptions: {
        rev_growth: [0.05, 0.05, 0.05, 0.03, 0.03],
        cogs_pct: [0.65, 0.65, 0.65, 0.65, 0.65],
        sga_pct: [0.15, 0.15, 0.15, 0.15, 0.15],
        da_pct: [0.05, 0.05, 0.05, 0.05, 0.05],
        tax_rate: 0.22,
        capex_pct: [0.06, 0.06, 0.06, 0.05, 0.05],
        nwc_pct: [0.01, 0.01, 0.01, 0.01, 0.01],
        wacc: 0.08, tgr: 0.02,
        net_debt: Math.round(assets[2] - equity[2]),
        peers: [], premium_pct: 0.0
      }
    };

    return NextResponse.json({ content: modelData });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}