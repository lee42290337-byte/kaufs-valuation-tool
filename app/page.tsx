// @ts-nocheck

"use client";

import { useState, useCallback, useMemo } from "react";

const TABS=["과거 실적","추정 수정 ✏️","추정 손익계산서","DCF","상대가치(PER/PBR)","민감도"];
const FY=["2024E","2025E","2026E","2027E","2028E"];

function fmt(n: any,d=0){if(n==null||isNaN(n))return"-";const a=Math.abs(n);return(n<0?"(":"")+a.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g,",")+(n<0?")":"")}
function pct(n: any){return n==null||isNaN(n)?"-":(n*100).toFixed(1)+"%"}
function mult(n: any){return n==null||isNaN(n)?"-":n.toFixed(1)+"x"}

function buildModel(d: any,a: any){
  const h=d.historical,hy=h.years.length,fy=5;
  const years=[...h.years,...FY];
  const rev=[...h.revenue],cogs=[...h.cogs],sga=[...h.sga],da=[...h.da];
  const op=[...h.op],interest=[...h.interest],ni=[...h.ni];
  for(let i=0;i<fy;i++){
    const r=rev[hy-1+i]*(1+a.rev_growth[i]);rev.push(Math.round(r));
    cogs.push(Math.round(r*a.cogs_pct[i]));sga.push(Math.round(r*a.sga_pct[i]));
    da.push(Math.round(r*a.da_pct[i]));
    const ebit=Math.round(r*(1-a.cogs_pct[i]-a.sga_pct[i]-a.da_pct[i]));
    op.push(ebit);interest.push(Math.round((h.interest[hy-1]||0)*.9));
    ni.push(Math.round((ebit+interest[interest.length-1])*(1-a.tax_rate)));
  }
  const gp=rev.map((r: number,i: number)=>r-cogs[i]);
  const opm=rev.map((r: number,i: number)=>r?op[i]/r:0),npm=rev.map((r: number,i: number)=>r?ni[i]/r:0),gpm=rev.map((r: number,i: number)=>r?gp[i]/r:0);
  const fcff=[];
  for(let i=0;i<fy;i++){const idx=hy+i;fcff.push(Math.round(op[idx]*(1-a.tax_rate)+da[idx]-rev[idx]*a.capex_pct[i]-rev[idx]*a.nwc_pct[i]))}
  const pvF=fcff.map((f: number,i: number)=>f/Math.pow(1+a.wacc,i+1));
  const sumPv=pvF.reduce((s: number,v: number)=>s+v,0);
  const tv=a.wacc>a.tgr?fcff[fy-1]*(1+a.tgr)/(a.wacc-a.tgr):0;
  const pvTv=tv/Math.pow(1+a.wacc,fy);
  const ev=sumPv+pvTv,eqVal=ev-a.net_debt;
  
  const targetDCF=d.shares>0?(eqVal/d.shares)*100:0;
  const epsF=d.shares>0?(ni[hy]/d.shares)*100:0; 
  const bpsF=(h.bps[hy-1]||0)+(d.shares>0?(ni[hy]/d.shares)*100:0);
  
  // ★ 유저가 입력한 커스텀 피어(Peer) 평균 계산
  const validPeers = a.peers?.filter((p: any) => p.per > 0 || p.pbr > 0) || [];
  const avgPER = validPeers.length ? validPeers.reduce((s: number,p: any)=>s+Number(p.per),0)/validPeers.length : 10;
  const avgPBR = validPeers.length ? validPeers.reduce((s: number,p: any)=>s+Number(p.pbr),0)/validPeers.length : 1.0;
  
  // ★ 유저가 입력한 타겟 프리미엄/할인율 적용
  const premiumMult = 1 + (a.premium_pct || 0);
  const tPER = epsF * avgPER * premiumMult;
  const tPBR = bpsF * avgPBR * premiumMult;
  
  const wD=a.w_dcf??0.6,wP=a.w_per??0.2,wB=a.w_pbr??0.2;
  const blended=targetDCF*wD+tPER*wP+tPBR*wB;
  
  const wR=[.07,.08,.09,.10,.11,.12,.13],gR=[.010,.015,.020,.025,.030,.035];
  const sensM=wR.map(w=>gR.map(g=>{if(w<=g)return null;const p=fcff.map((f,i)=>f/Math.pow(1+w,i+1)).reduce((s,v)=>s+v,0);const t=fcff[fy-1]*(1+g)/(w-g);return d.shares>0?Math.round(((p+t/Math.pow(1+w,fy)-a.net_debt)/d.shares)*100):0}));
  return{years,rev,cogs,gp,sga,da,op,interest,ni,opm,npm,gpm,fcff,pvF,sumPv,tv,pvTv,ev,eqVal,targetDCF,epsF,bpsF,avgPER,avgPBR,tPER,tPBR,blended,wR,gR,sensM,wD,wP,wB};
}

function EC({value,onChange,f="pct"}: any){
  const disp=f==="pct"?(value*100).toFixed(1):String(Math.round(value*100)/100);
  const [ed,setEd]=useState(false);const [tmp,setTmp]=useState(disp);
  if(ed)return <input autoFocus value={tmp} onChange={e=>setTmp(e.target.value)} onBlur={()=>{setEd(false);let v=parseFloat(tmp);if(!isNaN(v)){if(f==="pct")v/=100;onChange(v)}}} onKeyDown={e=>{if(e.key==="Enter"){setEd(false);let v=parseFloat(tmp);if(!isNaN(v)){if(f==="pct")v/=100;onChange(v)}}if(e.key==="Escape")setEd(false)}} style={{width:58,padding:"2px 4px",background:"#0e1828",border:"1px solid #00d2a0",borderRadius:3,color:"#00ffaa",fontSize:11,textAlign:"right",outline:"none",fontFamily:"'IBM Plex Mono',monospace"}}/>;
  return <span onClick={()=>{setTmp(disp);setEd(true)}} style={{cursor:"pointer",padding:"2px 6px",borderRadius:3,background:"rgba(0,100,255,0.06)",border:"1px dashed rgba(0,136,255,0.22)",color:"#4da6ff",fontSize:11,fontFamily:"'IBM Plex Mono',monospace",display:"inline-block",minWidth:48,textAlign:"right"}} title="클릭하여 수정">{f==="pct"?pct(value):fmt(value)}</span>;
}

function T({headers,rows,formats,highlight,colStyles}: any){
  return <div style={{overflowX:"auto",marginBottom:14}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"'IBM Plex Mono',monospace"}}>
    <thead><tr>{headers.map((h: string,i: number)=><th key={i} style={{padding:"6px 7px",background:"#11121e",color:"#5a6a7d",textAlign:i===0?"left":"right",borderBottom:"2px solid #181a28",fontSize:10,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((row: any,ri: number)=><tr key={ri} style={{background:highlight?.(ri)?"rgba(0,200,150,0.04)":"transparent"}}>{row.map((cell: any,ci: number)=><td key={ci} style={{padding:"4px 7px",borderBottom:"1px solid rgba(255,255,255,0.025)",textAlign:ci===0?"left":"right",whiteSpace:"nowrap",fontWeight:highlight?.(ri)?600:400,color:colStyles?.(ci,ri)??"#8a94a0",...(typeof cell==="number"&&cell<0?{color:"#ff6b6b"}:{})}}>{formats?.[ci]?formats[ci](cell):cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

function Mx({rL,cL,data,rF,cF,cFmt,bR,bC}: any){
  return <div style={{overflowX:"auto",marginBottom:14}}><table style={{borderCollapse:"collapse",fontSize:10,fontFamily:"'IBM Plex Mono',monospace"}}>
    <thead><tr><th style={{padding:"4px 5px",background:"#11121e",color:"#5a6a7d"}}></th>{cL.map((c: any,i: number)=><th key={i} style={{padding:"4px 5px",background:"#11121e",color:"#5a6a7d",textAlign:"center",minWidth:58}}>{cF?.(c)??c}</th>)}</tr></thead>
    <tbody>{rL.map((rl: any,ri: number)=><tr key={ri}><td style={{padding:"4px 5px",background:"rgba(17,18,30,0.5)",color:"#5a6a7d",fontWeight:600}}>{rF?.(rl)??rl}</td>{data[ri].map((v: any,ci: number)=>{const isB=ri===bR&&ci===bC;return <td key={ci} style={{padding:"4px 5px",textAlign:"center",background:isB?"rgba(0,200,150,0.1)":"transparent",color:isB?"#00ffaa":v==null?"#222":"#8a94a0",fontWeight:isB?700:400}}>{v==null?"-":(cFmt?.(v)??fmt(v))}</td>})}</tr>)}</tbody>
  </table></div>;
}

export default function App(){
  const [query,setQuery]=useState("");
  const [loading,setLoading]=useState(false);
  const [prog,setProg]=useState("");
  const [raw,setRaw]=useState<any>(null);
  const [a,setA]=useState<any>(null);
  const [tab,setTab]=useState(0);
  const [err,setErr]=useState("");
  const ua=useCallback((k: string,v: any)=>setA((p: any)=>({...p,[k]:v})),[]);
  const m=useMemo(()=>raw&&a?buildModel(raw,a):null,[raw,a]);

  const go=useCallback(async()=>{
    if(!query.trim())return;setLoading(true);setErr("");setRaw(null);setA(null);
    setProg("DART 실적 및 실시간 주가 수집 중...");
    try{
      const res = await fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: query.trim() }) });
      const j = await res.json();
      if(j.error) throw new Error(j.error);
      const p = j.content;
      setRaw(p); setA({...p.assumptions,w_dcf:0.6,w_per:0.2,w_pbr:0.2}); setTab(0);
    }catch(e: any){setErr("오류: "+e.message)}
    setLoading(false);setProg("");
  },[query]);

  const d=raw,h=raw?.historical;

  const hMetrics=useMemo(()=>{
    if(!h)return null;
    const opm=h.revenue.map((r: number,i: number)=>r?h.op[i]/r:0);
    const growth=h.revenue.map((r: number,i: number)=>i===0?null:(r-h.revenue[i-1])/h.revenue[i-1]);
    return{opm,growth};
  },[h]);

  return(
    <div style={{minHeight:"100vh",background:"#0b0c14",fontFamily:"'Pretendard','IBM Plex Sans KR',sans-serif",color:"#c8cdd4"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{height:5px;width:5px}::-webkit-scrollbar-thumb{background:#222;border-radius:3px}input::placeholder{color:#445}button:hover{opacity:0.8}`}</style>
      
      <div style={{padding:"14px 18px",borderBottom:"1px solid rgba(255,255,255,0.04)",background:"#0d0e18",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <div style={{width:28,height:28,borderRadius:6,background:"linear-gradient(135deg,#00d2a0,#0077ff)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"#080810"}}>F</div>
          <div><div style={{fontSize:13,fontWeight:700}}>Financial Modeler</div><div style={{fontSize:8,color:"#3a3a4a",letterSpacing:1.2}}>PRO EDITION</div></div>
        </div>
        <div style={{display:"flex",gap:6,flex:1,maxWidth:400}}>
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="기업명 (테스트: 삼성전자, SK하이닉스, 네이버, 현대차)" style={{flex:1,padding:"8px 12px",borderRadius:6,border:"1px solid #181a28",background:"#111220",color:"#fff",fontSize:12,outline:"none",fontFamily:"inherit"}}/>
          <button onClick={go} disabled={loading} style={{padding:"8px 18px",borderRadius:6,border:"none",background:loading?"#1a1a2e":"linear-gradient(135deg,#00d2a0,#0077ff)",color:loading?"#444":"#000",fontSize:12,fontWeight:700,cursor:loading?"default":"pointer",fontFamily:"inherit"}}>{loading?"분석중...":"분석"}</button>
        </div>
      </div>

      {loading&&<div style={{padding:50,textAlign:"center"}}><div style={{width:32,height:32,border:"3px solid #181a28",borderTopColor:"#00d2a0",borderRadius:"50%",margin:"0 auto 12px",borderTopStyle:"solid"}}/><div style={{color:"#00d2a0",fontSize:12}}>{prog}</div></div>}
      {err&&<div style={{padding:20,textAlign:"center",color:"#ff6b6b",fontSize:12}}>{err}</div>}

      {d&&m&&a&&(
        <div>
          <div style={{padding:"10px 18px",borderBottom:"1px solid rgba(255,255,255,0.04)",display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap",fontSize:12}}>
            <span style={{fontSize:15,fontWeight:700}}>{d.company}</span>
            <span style={{color:"#3a3a4a",fontFamily:"'IBM Plex Mono',monospace",fontSize:10}}>{d.ticker}</span>
            <span style={{color:"#00d2a0",fontWeight:600,fontSize:13}}>{fmt(d.price)}원 (현재)</span>
            <span style={{marginLeft:"auto",fontWeight:600,color:m.blended>d.price?"#00d2a0":"#ff6b6b"}}>
              종합 목표주가 {fmt(Math.round(m.blended))}원 ({m.blended>d.price?"+":""}{((m.blended/d.price-1)*100).toFixed(1)}%)
            </span>
          </div>

          <div style={{display:"flex",padding:"0 18px",borderBottom:"1px solid rgba(255,255,255,0.04)",overflowX:"auto"}}>
            {TABS.map((t,i)=><button key={i} onClick={()=>setTab(i)} style={{padding:"8px 12px",border:"none",background:"transparent",color:tab===i?"#00d2a0":"#3a3a4a",fontSize:11,fontWeight:tab===i?700:400,cursor:"pointer",borderBottom:tab===i?"2px solid #00d2a0":"2px solid transparent",fontFamily:"inherit",whiteSpace:"nowrap"}}>{t}</button>)}
          </div>

          <div style={{padding:"16px 18px",maxWidth:1050}}>
            {tab===0&&( <T headers={["손익계산서",...h.years]} rows={[["매출액",...h.revenue],["영업이익",...h.op],["당기순이익",...h.ni],["───",...h.years.map(()=>"")],["영업이익률",...hMetrics.opm.map((v: number)=>pct(v))],["매출성장률",...hMetrics.growth.map((v: number|null)=>v==null?"-":pct(v))]]} formats={[(v: any)=>v,...h.years.map(()=>(v: any)=>typeof v==="string"?v:fmt(v))]} highlight={(ri: number)=>ri===1||ri===2}/> )}

            {tab===1&&(
              <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:20}}>
                <div>
                  <div style={{fontSize:12,fontWeight:600,color:"#5a6a7d",marginBottom:6}}>▶ 미래 5년 마진/비용 구조</div>
                  {[["매출원가율","cogs_pct"],["판관비율","sga_pct"],["CAPEX(%)","capex_pct"]].map(([l,k])=>(
                    <div key={k} style={{display:"flex",alignItems:"center",gap:2,marginBottom:4}}><span style={{width:100,fontSize:10,color:"#5a6a7d"}}>{l}</span><div style={{display:"flex",gap:2}}>{a[k].map((v: number,i: number)=><EC key={i} value={v} onChange={(nv: number)=>{const c=[...a[k]];c[i]=nv;ua(k,c)}}/>)}</div></div>
                  ))}
                </div>
                <div>
                  <div style={{fontSize:12,fontWeight:600,color:"#5a6a7d",marginBottom:6}}>▶ DCF / 비중 세팅</div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}><span style={{width:100,fontSize:10,color:"#5a6a7d"}}>WACC</span><EC value={a.wacc} onChange={(nv: number)=>ua("wacc",nv)} f="pct"/></div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}><span style={{width:100,fontSize:10,color:"#5a6a7d"}}>영구성장률(TGR)</span><EC value={a.tgr} onChange={(nv: number)=>ua("tgr",nv)} f="pct"/></div>
                  <div style={{marginTop:8,fontSize:10,color:"#3a3a4a"}}>밸류에이션 비중:</div>
                  <div style={{display:"flex",gap:10,marginTop:2}}>{[["DCF","w_dcf"],["PER","w_per"],["PBR","w_pbr"]].map(([l,k])=>( <div key={k} style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:10,color:"#5a6a7d"}}>{l}</span><EC value={a[k]} onChange={(v: number)=>ua(k,v)}/></div> ))}</div>
                </div>
              </div>
            )}
            
            {tab===2&&( <T headers={["항목",...m.years]} rows={[["매출액",...m.rev],["영업이익",...m.op],["당기순이익",...m.ni]]} formats={[(v: any)=>v,...m.years.map(()=>(v: any)=>typeof v==="string"?v:fmt(v))]} highlight={(ri: number)=>ri===1}/> )}
            {tab===3&&( <T headers={["FCFF (잉여현금흐름)",...FY]} rows={[["EBIT",...m.op.slice(h.years.length)],["Tax",...m.op.slice(h.years.length).map((o: number)=>-Math.round(o*a.tax_rate))],["D&A",...m.da.slice(h.years.length)],["CAPEX",...m.rev.slice(h.years.length).map((r: number,i: number)=>-Math.round(r*a.capex_pct[i]))],["FCFF",...m.fcff],["현재가치(PV)",...m.pvF.map((v: number)=>Math.round(v))]]} formats={[(v: any)=>v,...Array(5).fill((v: any)=>fmt(v))]} highlight={(ri: number)=>ri===4}/> )}
            
            {/* ★ 핵심 업데이트: 완벽하게 커스텀 가능한 4번 탭 */}
            {tab===4&&(
              <div>
                <div style={{padding:"10px 12px",borderRadius:6,background:"rgba(0,119,255,0.04)",border:"1px solid rgba(0,119,255,0.1)",marginBottom:16,fontSize:11,color:"#4a8ac0"}}>
                  💡 내 논리에 맞는 경쟁사를 직접 구성하고, 타겟 기업이 받을 프리미엄을 부여하세요.
                </div>
                
                {/* 피어(Peer) 에디터 테이블 */}
                <div style={{marginBottom: 20}}>
                  <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#5a6a7d"}}>🏢 비교군 (Peer Group) 설정</div>
                    <button onClick={() => ua("peers", [...a.peers, {name: "새 기업", per: 10, pbr: 1.0}])} style={{padding:"4px 8px", background:"#1a1a2e", border:"1px solid #00d2a0", color:"#00ffaa", borderRadius:4, fontSize:10, cursor:"pointer"}}>+ 추가</button>
                  </div>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"'IBM Plex Mono',monospace"}}>
                    <thead>
                      <tr>
                        <th style={{padding:"6px",background:"#11121e",color:"#5a6a7d",textAlign:"left"}}>기업명</th>
                        <th style={{padding:"6px",background:"#11121e",color:"#5a6a7d",textAlign:"right"}}>Target PER (배)</th>
                        <th style={{padding:"6px",background:"#11121e",color:"#5a6a7d",textAlign:"right"}}>Target PBR (배)</th>
                        <th style={{padding:"6px",background:"#11121e",color:"#5a6a7d",textAlign:"center"}}>관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.peers?.map((p: any, i: number) => (
                        <tr key={i} style={{borderBottom:"1px solid rgba(255,255,255,0.025)"}}>
                          <td style={{padding:"6px"}}>
                            <input value={p.name} onChange={e => { const np = [...a.peers]; np[i].name = e.target.value; ua("peers", np); }} style={{width: 120, padding: "2px 6px", background: "rgba(0,100,255,0.06)", border: "1px dashed rgba(0,136,255,0.22)", borderRadius: 3, color: "#4da6ff", fontSize: 11, outline: "none", fontFamily: "inherit"}} />
                          </td>
                          <td style={{padding:"6px",textAlign:"right"}}><EC value={p.per} f="num" onChange={(v: number) => { const np = [...a.peers]; np[i].per = v; ua("peers", np); }} /></td>
                          <td style={{padding:"6px",textAlign:"right"}}><EC value={p.pbr} f="num" onChange={(v: number) => { const np = [...a.peers]; np[i].pbr = v; ua("peers", np); }} /></td>
                          <td style={{padding:"6px",textAlign:"center"}}><button onClick={() => { const np = a.peers.filter((_: any, idx: number) => idx !== i); ua("peers", np); }} style={{background:"transparent",border:"none",color:"#ff6b6b",cursor:"pointer",fontSize:12}}>❌</button></td>
                        </tr>
                      ))}
                      <tr style={{background:"rgba(0,200,150,0.04)"}}>
                        <td style={{padding:"8px 6px",fontWeight:700,color:"#00d2a0"}}>평균 (Average)</td>
                        <td style={{padding:"8px 6px",textAlign:"right",fontWeight:700,color:"#00d2a0"}}>{m.avgPER.toFixed(1)}x</td>
                        <td style={{padding:"8px 6px",textAlign:"right",fontWeight:700,color:"#00d2a0"}}>{m.avgPBR.toFixed(1)}x</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* 타겟 프리미엄 에디터 및 결과 */}
                <div style={{padding:16,borderRadius:8,background:"linear-gradient(135deg,rgba(0,210,160,0.04),rgba(0,119,255,0.04))",border:"1px solid rgba(0,210,160,0.1)"}}>
                  <div style={{display:"flex", alignItems:"center", gap: 12, marginBottom: 14, borderBottom: "1px dashed rgba(255,255,255,0.1)", paddingBottom: 14}}>
                    <span style={{fontSize:13,fontWeight:600,color:"#fff"}}>타겟 기업 프리미엄 / 할인율 부여:</span>
                    <EC value={a.premium_pct} f="pct" onChange={(v: number)=>ua("premium_pct",v)} />
                    <span style={{fontSize:10,color:"#888"}}>(예: 경쟁사 대비 20% 할증 시 파란 글씨를 20%로 수정)</span>
                  </div>
                  
                  <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:16}}>
                    <div>
                      <div style={{fontSize:10,color:"#888",marginBottom:4}}>적용된 PER (평균 {m.avgPER.toFixed(1)}x + 프리미엄) = {(m.avgPER * (1 + a.premium_pct)).toFixed(1)}x</div>
                      <div style={{fontSize:14,fontWeight:700,color:"#00d2a0"}}>PER 목표가: {fmt(Math.round(m.tPER))}원</div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:"#888",marginBottom:4}}>적용된 PBR (평균 {m.avgPBR.toFixed(1)}x + 프리미엄) = {(m.avgPBR * (1 + a.premium_pct)).toFixed(1)}x</div>
                      <div style={{fontSize:14,fontWeight:700,color:"#00d2a0"}}>PBR 목표가: {fmt(Math.round(m.tPBR))}원</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab===5&&( <div><div style={{fontSize:11,color:"#555",marginBottom:6}}>WACC × TGR 민감도 분석</div><Mx rL={m.wR} cL={m.gR} data={m.sensM} rF={(v: number)=>pct(v)} cF={(v: number)=>pct(v)} cFmt={(v: number)=>fmt(v)} bR={m.wR.indexOf(a.wacc)} bC={m.gR.indexOf(a.tgr)}/></div> )}
          </div>
        </div>
      )}
    </div>
  );
}