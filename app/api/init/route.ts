import { NextResponse } from "next/server";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeXml(m[1].trim()) : "";
}

export async function GET() {
  try {
    const apiKey = process.env.DART_API_KEY;

    if (!apiKey) {
      throw new Error("DART API 키가 설정되지 않았습니다. .env.local 파일을 확인하세요.");
    }

    const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${apiKey}`;

    const res = await fetch(url, {
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`DART 기업 목록 다운로드 실패: HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let xmlData = "";

    try {
      const zip = new AdmZip(buffer);
      xmlData = zip.readAsText("CORPCODE.xml");
    } catch {
      const text = buffer.toString("utf-8");

      if (text.includes("<status>")) {
        const status = getTag(text, "status");
        const message = getTag(text, "message");

        throw new Error(`DART 오류: ${status} / ${message}`);
      }

      throw new Error("DART 응답 ZIP 압축 해제에 실패했습니다.");
    }

    if (!xmlData || !xmlData.includes("<list>")) {
      throw new Error("DART 기업 목록 XML 형식이 올바르지 않습니다.");
    }

    const corpMap: Record<string, { dart: string; stock: string }> = {};

    const items = xmlData.split("</list>");

    for (const item of items) {
      const corpCode = getTag(item, "corp_code");
      const corpName = getTag(item, "corp_name");
      const stockCode = getTag(item, "stock_code");

      if (corpCode && corpName && stockCode && /^\d{6}$/.test(stockCode)) {
        corpMap[corpName.trim()] = {
          dart: corpCode.trim(),
          stock: stockCode.trim(),
        };
      }
    }

    // 자주 쓰는 별칭 추가
    const aliases: Record<string, string> = {
      삼성: "삼성전자",
      삼성전자: "삼성전자",
      하이닉스: "SK하이닉스",
      sk하이닉스: "SK하이닉스",
      SK하이닉스: "SK하이닉스",
      현대차: "현대자동차",
      현대자동차: "현대자동차",
      네이버: "NAVER",
      NAVER: "NAVER",
      카카오: "카카오",
      LG전자: "LG전자",
      엘지전자: "LG전자",
      기아: "기아",
      셀트리온: "셀트리온",
      포스코홀딩스: "POSCO홀딩스",
      POSCO홀딩스: "POSCO홀딩스",
    };

    for (const [alias, realName] of Object.entries(aliases)) {
      if (corpMap[realName]) {
        corpMap[alias] = corpMap[realName];
      }
    }

    const filePath = path.join(process.cwd(), "dart_map.json");

    fs.writeFileSync(filePath, JSON.stringify(corpMap, null, 2), "utf-8");

    return NextResponse.json({
      success: true,
      count: Object.keys(corpMap).length,
      message: "성공적으로 전체 상장사 DB를 구축했습니다. 이제 검색이 가능합니다.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "기업 DB 초기화 실패",
      },
      { status: 500 }
    );
  }
}