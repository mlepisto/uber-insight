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
  h+=`<h2 style="margin:0 0 2px">OGG Wave Board</h2><div style="color:${muted};font-size:13px;margin-bottom:10px">${label(today)} · daily brief</div>`;
  h+=`<div style="margin:0 0 16px"><a href="https://mlepisto.github.io/uber-insight/" style="display:inline-block;background:${A};color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:9px">Open the live dashboard &rarr;</a></div>`;
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
  // NEXT 7 DAYS — email-safe bar strip (flight seats in coral, cruise pax in teal)
  h+=`<h3 style="margin:20px 0 6px;border-bottom:2px solid ${T};padding-bottom:4px">Next 7 days</h3>`;
  const wk=[]; let maxT=1;
  for(let i=0;i<7;i++){ const d=hstDate(i), s=daySummary(flightsByDay[d]), cr=cruiseFor(d,calls);
    const fl=s?s.seats:0, cpax=cr.reduce((a,c)=>a+(c.pax||0),0), t=fl+cpax;
    if(t>maxT)maxT=t; wk.push({d,fl,cpax,ship:cr[0]?cr[0].ship:null,t}); }
  h+=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">`;
  for(const r of wk){ const pf=Math.round(r.fl/maxT*100), pc=Math.round(r.cpax/maxT*100), rest=Math.max(0,100-pf-pc);
    h+=`<tr><td style="padding:5px 8px 5px 0;white-space:nowrap;color:${ink};font-weight:600;width:74px">${label(r.d)}</td>`+
      `<td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>`+
      (pf>0?`<td width="${pf}%" style="background:${A};height:15px;font-size:0;line-height:0">&nbsp;</td>`:``)+
      (pc>0?`<td width="${pc}%" style="background:${T};height:15px;font-size:0;line-height:0">&nbsp;</td>`:``)+
      `<td width="${rest}%" style="font-size:0;line-height:0">&nbsp;</td></tr></table></td>`+
      `<td style="padding:5px 0 5px 10px;text-align:right;white-space:nowrap;color:${muted}">${r.t.toLocaleString()}${r.ship?` 🚢`:``}</td></tr>`; }
  h+=`</table>`;
  h+=`<p style="color:${muted};font-size:12px;margin:8px 2px 0"><span style="color:${A};font-weight:700">■</span> flight seats &nbsp; <span style="color:${T};font-weight:700">■</span> cruise pax &nbsp; 🚢 ship in port. Tap the dashboard for the interactive by-hour and by-day curves.</p>`;
  h+=`<p style="color:${muted};font-size:11px;margin-top:14px">Cruise: CruiseMapper. Flights: AeroDataBox. Times HST. Day-of status is a fresh pull; open the board and tap Update for to-the-minute delays.</p></div>`;
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
