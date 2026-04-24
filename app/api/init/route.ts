import { NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const apiKey = process.env.DART_API_KEY;
    if (!apiKey) throw new Error("DART API 키가 설정되지 않았습니다.");

    // 1. DART에서 전체 상장사 목록(ZIP) 다운로드
    const res = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${apiKey}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    // 2. 압축 풀기 및 XML 텍스트 읽기
    const zip = new AdmZip(buffer);
    const xmlData = zip.readAsText("CORPCODE.xml");

    // 3. XML에서 상장된 기업(종목코드가 있는 기업)만 추출하여 JSON 객체로 변환
    const corpMap: Record<string, { dart: string, stock: string }> = {};
    const items = xmlData.split('</list>');
    
    for (const item of items) {
      const cMatch = item.match(/<corp_code>(\d{8})<\/corp_code>/);
      const nMatch = item.match(/<corp_name>([^<]+)<\/corp_name>/);
      const sMatch = item.match(/<stock_code>(\d{6})<\/stock_code>/);

      // 종목코드가 존재하는 상장사만 사전에 등록
      if (cMatch && nMatch && sMatch) {
        corpMap[nMatch[1].trim()] = { dart: cMatch[1], stock: sMatch[1] };
      }
    }

    // 4. 추출한 데이터를 프로젝트 폴더에 dart_map.json 으로 저장
    const filePath = path.join(process.cwd(), 'dart_map.json');
    fs.writeFileSync(filePath, JSON.stringify(corpMap, null, 2));

    return NextResponse.json({ 
      success: true, 
      count: Object.keys(corpMap).length, 
      message: "성공적으로 전체 상장사 DB를 구축했습니다! 이제 검색이 가능합니다." 
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}