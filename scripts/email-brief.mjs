// Daily OGG brief -> email via Resend. Reads the already-committed data files
// (data/flights.json from flights.mjs, data/cruise.json from the scraper) and sends.
// Makes NO API calls of its own. Run after flights.mjs in the same workflow.
// Env: RESEND_API_KEY (required to send), EMAIL_TO (default mika@lepisto.com),
//   EMAIL_FROM (default onboarding@resend.dev), DRY=1 -> print instead of send.
import { readFileSync } from "node:fs";

const RESEND_KEY=process.env.RESEND_API_KEY||"";
const EMAIL_TO=process.env.EMAIL_TO||"mika@lepisto.com";
const EMAIL_FROM=process.env.EMAIL_FROM||"OGG Wave Board <onboarding@resend.dev>";
const DRY=!!process.env.DRY||!RESEND_KEY;

const pad=n=>String(n).padStart(2,"0");
const toMin=t=>{const[a,b]=t.split(":").map(Number);return a*60+b;};
const to12=m=>{const h=Math.floor(m/60),mm=m%60,ap=h>=12?"pm":"am";return(((h+11)%12)+1)+":"+pad(mm)+ap;};
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const INTER=new Set(["HNL","KOA","LIH","ITO","MKK","LNY"]);
function weight(o){ if(!INTER.has(o)) return 1.0; return o==="HNL"?0.35:0.45; }
const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function hstDate(off){ const h=new Date(Date.now()-10*3600*1000); const d=new Date(Date.UTC(h.getUTCFullYear(),h.getUTCMonth(),h.getUTCDate()+off));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; }
function dowOf(s){const[y,m,d]=s.split("-").map(Number);return new Date(Date.UTC(y,m-1,d)).getUTCDay();}
function label(s){const[y,m,d]=s.split("-").map(Number);return DOW[dowOf(s)]+" "+MON[m-1]+" "+d;}
function ordStr(s){const[y,m,d]=s.split("-").map(Number);return Math.floor(Date.UTC(y,m-1,d)/86400000);}

function daySummary(flights){
  if(!flights||!flights.length) return null;
  const live=flights.filter(f=>!f.cancelled);
  const blocks={};
  for(const f of live){ const b=Math.floor(f.effMin/30)*30; (blocks[b]=blocks[b]||{seats:0,score:0}); blocks[b].seats+=f.seats; blocks[b].score+=f.seats*weight(f.org); }
  const waves=Object.entries(blocks).map(([m,v])=>({m:+m,...v})).sort((a,b)=>b.score-a.score).slice(0,3).sort((a,b)=>a.m-b.m);
  return { arrivals:live.length, seats:live.reduce((s,f)=>s+f.seats,0), wb:live.filter(f=>f.wb).length,
    late:flights.filter(f=>f.live&&f.delayMin>=15&&!f.landed&&!f.cancelled).length,
    cxl:flights.filter(f=>f.cancelled).length, waves };
}

const PICKUP_AFTER=[45,165], RETURN_BEFORE=[210,60];
function cruiseFor(dateStr, calls){
  const o=ordStr(dateStr), out=[];
  for(const c of calls){ if(!c.arr||!c.dep) continue;
    const aO=ordStr(c.arr.date), dO=ordStr(c.dep.date); if(o<aO||o>dO) continue;
    const isArr=o===aO, isDep=o===dO, am=toMin(c.arr.time), dm=toMin(c.dep.time), win=[];
    if(isArr) win.push("Ship→rental/town "+to12(Math.max(0,am+PICKUP_AFTER[0]))+"–"+to12(am+PICKUP_AFTER[1]));
    if(isDep) win.push("Rental/town→ship "+to12(Math.max(0,dm-RETURN_BEFORE[0]))+"–"+to12(dm-RETURN_BEFORE[1]));
    out.push({ship:c.ship,line:c.line,pax:c.pax,
      span:isArr&&isDep?("in port "+to12(am)+"–"+to12(dm)):isArr?("arrives "+to12(am)+", overnight"):isDep?("sails "+to12(dm)):"in port all day",win});
  }
  return out;
}

function buildHTML(today, flightsByDay, calls){
  const A="#E4572E",T="#0E7C7B",ink="#182A31",muted="#5E6E74";
  let h=`<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;color:${ink}">`;
  h+=`<h2 style="margin:0 0 2px">OGG Wave Board</h2><div style="color:${muted};font-size:13px;margin-bottom:14px">${label(today)} · daily brief</div>`;
  // TODAY
  h+=`<h3 style="margin:16px 0 6px;border-bottom:2px solid ${A};padding-bottom:4px">Today — ${label(today)}</h3>`;
  const s=daySummary(flightsByDay[today]);
  if(s){ h+=`<p style="margin:6px 0"><b>${s.arrivals}</b> arrivals · <b>${s.seats.toLocaleString()}</b> seats · ${s.wb} widebody`;
    if(s.late) h+=` · <span style="color:${A}">${s.late} late</span>`; if(s.cxl) h+=` · ${s.cxl} cancelled`; h+=`</p>`;
    if(s.waves.length) h+=`<p style="margin:6px 0;color:${muted}">Best waves: `+s.waves.map(w=>to12(w.m)+" ("+w.seats+" seats)").join(" · ")+`</p>`;
  } else h+=`<p style="margin:6px 0;color:${muted}">No flight data yet (add AERODATABOX_KEY secret).</p>`;
  const ct=cruiseFor(today,calls);
  if(ct.length) for(const c of ct){ h+=`<div style="margin:8px 0;padding:8px 10px;background:#eef6f5;border-left:3px solid ${T};border-radius:6px"><b>${esc(c.ship)}</b> <span style="color:${muted}">${esc(c.line)}${c.pax?" · ~"+c.pax.toLocaleString()+" pax":""} · ${c.span}</span>`;
    for(const w of c.win) h+=`<div style="font-size:13px;color:${T};font-weight:600">${w}</div>`; h+=`</div>`; }
  else h+=`<p style="margin:6px 0;color:${muted}">No cruise ship in port today.</p>`;
  // NEXT DAYS (rest of the rolling window)
  h+=`<h3 style="margin:20px 0 6px;border-bottom:2px solid ${T};padding-bottom:4px">Coming days</h3>`;
  for(let i=1;i<=6;i++){ const d=hstDate(i), cr=cruiseFor(d,calls), ss=daySummary(flightsByDay[d]);
    h+=`<div style="margin:7px 0;padding-bottom:7px;border-bottom:1px solid #eee"><b>${label(d)}</b>`;
    if(ss) h+=` <span style="color:${muted}">— ${ss.arrivals} arr · ${ss.seats.toLocaleString()} seats${ss.wb?" · "+ss.wb+" WB":""}</span>`;
    if(cr.length) for(const c of cr) h+=`<div style="color:${T};font-weight:600;font-size:13px">🚢 ${esc(c.ship)} — ${c.span}</div>`;
    else if(!ss) h+=` <span style="color:${muted}">—</span>`;
    h+=`</div>`; }
  h+=`<p style="color:${muted};font-size:11px;margin-top:16px">Cruise: CruiseMapper. Flights: AeroDataBox. Times HST. Day-of status is a fresh pull; open the board and tap Update for to-the-minute delays.</p></div>`;
  return h;
}

async function send(subject, html){
  if(DRY){ console.log("[DRY] To:",EMAIL_TO,"| Subject:",subject,"\n"+html.slice(0,1400)); return; }
  const r=await fetch("https://api.resend.com/emails",{method:"POST",
    headers:{"Authorization":"Bearer "+RESEND_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({from:EMAIL_FROM,to:[EMAIL_TO],subject,html})});
  const t=await r.text(); if(!r.ok) throw new Error("Resend HTTP "+r.status+" "+t); console.log("Sent:",t);
}

function readJSON(p){ try{ return JSON.parse(readFileSync(p,"utf8")); }catch(e){ return null; } }
async function main(){
  const fj=readJSON("data/flights.json")||{days:{}}, cj=readJSON("data/cruise.json")||{calls:[]};
  const today=fj.day||hstDate(0), byDay=fj.days||{}, calls=cj.calls||[];
  const html=buildHTML(today, byDay, calls);
  const s=daySummary(byDay[today]); const ct=cruiseFor(today,calls);
  const subject="OGG "+label(today)+(s?` · ${s.arrivals} arr, ${s.seats.toLocaleString()} seats${s.late?", "+s.late+" late":""}`:"")+(ct.length?` · 🚢 ${ct[0].ship}`:"");
  await send(subject, html);
}
main().catch(e=>{ console.error(e); process.exit(1); });
