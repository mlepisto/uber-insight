// Daily OGG brief -> email via Resend. Runs on GitHub Actions.
// Sections: TODAY (real arrivals + cruise) and NEXT 7 DAYS (cruise + flight schedule).
// Flights come from AeroDataBox; today is pulled fresh each run, the 7-day schedule is
// cached in data/flights-week.json and only refreshed when older than CACHE_MAX_AGE.
// Secrets/env: RESEND_API_KEY (required to send), AERODATABOX_KEY (flights),
//   EMAIL_TO (default mika@lepisto.com), EMAIL_FROM (default onboarding@resend.dev).
//   DRY=1 -> compose and print, do not send.
import { readFileSync, writeFileSync } from "node:fs";

const ADB_KEY = process.env.AERODATABOX_KEY || "";
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_TO = process.env.EMAIL_TO || "mika@lepisto.com";
const EMAIL_FROM = process.env.EMAIL_FROM || "OGG Wave Board <onboarding@resend.dev>";
const DRY = !!process.env.DRY || !RESEND_KEY;
const CACHE = "data/flights-week.json";
const CACHE_MAX_AGE = 3*24*3600*1000; // refresh the week schedule at most every ~3 days

const pad=n=>String(n).padStart(2,"0");
const toMin=t=>{const[a,b]=t.split(":").map(Number);return a*60+b;};
const to12=m=>{const h=Math.floor(m/60),mm=m%60,ap=h>=12?"pm":"am";return(((h+11)%12)+1)+":"+pad(mm)+ap;};
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const INTER=new Set(["HNL","KOA","LIH","ITO","MKK","LNY"]);
const CITY={HNL:"Honolulu",KOA:"Kona",LIH:"Lihue",ITO:"Hilo",LAX:"Los Angeles",SFO:"San Francisco",SEA:"Seattle",PDX:"Portland",SAN:"San Diego",SJC:"San Jose",OAK:"Oakland",SMF:"Sacramento",LAS:"Las Vegas",PHX:"Phoenix",DEN:"Denver",SLC:"Salt Lake City",DFW:"Dallas",ORD:"Chicago",EWR:"Newark",ANC:"Anchorage",YVR:"Vancouver"};
const CARGO_RE=/fedex|ups|united parcel|cargo|freight|atlas air|kalitta|abx|cargolux|dhl|amerijet|ameriflight/i;
function weight(o){ if(!INTER.has(o)) return 1.0; return o==="HNL"?0.35:0.45; }
function seatFromModel(m){ m=(m||"").toLowerCase(); const wb=/a330|a340|a350|767|777|787|747/.test(m); let s=160;
  if(/a330/.test(m))s=278;else if(/a350/.test(m))s=300;else if(/787-9|789/.test(m))s=257;else if(/787|788/.test(m))s=243;
  else if(/777/.test(m))s=290;else if(/767/.test(m))s=240;else if(/a321neo|a21n|a321n/.test(m))s=189;else if(/a321/.test(m))s=190;
  else if(/a320neo|a20n/.test(m))s=180;else if(/a320/.test(m))s=170;else if(/a319/.test(m))s=128;else if(/757/.test(m))s=199;
  else if(/717/.test(m))s=128;else if(/max\s*9|737-9|7m9/.test(m))s=178;else if(/max\s*8|737-8|7m8/.test(m))s=175;
  else if(/737-900|739/.test(m))s=178;else if(/737-800|738/.test(m))s=166;else if(/737-700|737-7|73w/.test(m))s=143;
  else if(/e175|erj|embraer|175/.test(m))s=76; return {s,wb}; }

function hstDate(off=0){ const h=new Date(Date.now()-10*3600*1000); const d=new Date(Date.UTC(h.getUTCFullYear(),h.getUTCMonth(),h.getUTCDate()+off));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; }
function dowOf(dateStr){ const[y,m,d]=dateStr.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)).getUTCDay(); }
function label(dateStr){ const[y,m,d]=dateStr.split("-").map(Number); return DOW[dowOf(dateStr)]+" "+MON[m-1]+" "+d; }

async function fetchDay(dateStr){
  if(!ADB_KEY) return [];
  const base="https://aerodatabox.p.rapidapi.com/flights/airports/icao/PHOG/";
  const opt="?direction=Arrival&withLeg=false&withCancelled=false&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false";
  const hdr={headers:{"X-RapidAPI-Key":ADB_KEY,"X-RapidAPI-Host":"aerodatabox.p.rapidapi.com"}};
  const wins=[["00:00","11:59"],["12:00","23:59"]]; let arr=[];
  for(const [a,b] of wins){
    const r=await fetch(base+dateStr+"T"+a+"/"+dateStr+"T"+b+opt,hdr);
    if(!r.ok) throw new Error("AeroDataBox HTTP "+r.status);
    const j=await r.json(); arr=arr.concat(j.arrivals||[]);
  }
  return parse(arr);
}
function parse(arr){
  const out=[];
  for(const f of arr){
    const name=(f.airline&&f.airline.name)||""; if(CARGO_RE.test(name)) continue;
    const mv=f.movement||f.arrival||{};
    const sched=mv.scheduledTime&&(mv.scheduledTime.local||"");
    const eff=(mv.revisedTime&&mv.revisedTime.local)||(mv.predictedTime&&mv.predictedTime.local)||sched;
    if(!sched&&!eff) continue;
    const hm=(eff||sched).slice(11,16); const ap=mv.airport||{}; const org=(ap.iata||ap.icao||"").toUpperCase();
    const ac=seatFromModel(f.aircraft&&f.aircraft.model);
    out.push({min:toMin(hm),flt:(f.number||"").replace(/\s/g,""),carrier:name,org,seats:ac.s,wb:ac.wb,inter:INTER.has(org)});
  }
  return out.sort((a,b)=>a.min-b.min);
}

// summary of a day's flights: totals + top wave windows (30-min blocks by earning score)
function daySummary(flights){
  const blocks={};
  for(const f of flights){ const b=Math.floor(f.min/30)*30; (blocks[b]=blocks[b]||{seats:0,score:0,n:0}); blocks[b].seats+=f.seats; blocks[b].score+=f.seats*weight(f.org); blocks[b].n++; }
  const waves=Object.entries(blocks).map(([m,v])=>({m:+m,...v})).sort((a,b)=>b.score-a.score).slice(0,3).sort((a,b)=>a.m-b.m);
  return { arrivals:flights.length, seats:flights.reduce((s,f)=>s+f.seats,0), wb:flights.filter(f=>f.wb).length, waves };
}

// cruise
const PICKUP_AFTER=[45,165], RETURN_BEFORE=[210,60];
function ordStr(s){const[y,m,d]=s.split("-").map(Number);return Math.floor(Date.UTC(y,m-1,d)/86400000);}
function cruiseFor(dateStr, calls){
  const o=ordStr(dateStr), out=[];
  for(const c of calls){
    if(!c.arr||!c.dep) continue;
    const aO=ordStr(c.arr.date), dO=ordStr(c.dep.date);
    if(o<aO||o>dO) continue;
    const isArr=o===aO, isDep=o===dO, am=toMin(c.arr.time), dm=toMin(c.dep.time);
    const win=[];
    if(isArr) win.push("Ship→rental/town "+to12(Math.max(0,am+PICKUP_AFTER[0]))+"–"+to12(am+PICKUP_AFTER[1]));
    if(isDep) win.push("Rental/town→ship "+to12(Math.max(0,dm-RETURN_BEFORE[0]))+"–"+to12(dm-RETURN_BEFORE[1]));
    out.push({ship:c.ship,line:c.line,pax:c.pax,isArr,isDep,
      span:isArr&&isDep?("in port "+to12(am)+"–"+to12(dm)):isArr?("arrives "+to12(am)+", overnight"):isDep?("sails "+to12(dm)):"in port all day",
      win});
  }
  return out;
}

/* ---- compose ---- */
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function waveLine(w){ return to12(w.m)+" ("+w.seats+" seats)"; }
function buildHTML(today, todayFlights, cruiseToday, week){
  const A="#E4572E", T="#0E7C7B", ink="#182A31", muted="#5E6E74";
  let h=`<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;color:${ink}">`;
  h+=`<h2 style="margin:0 0 2px">OGG Wave Board</h2><div style="color:${muted};font-size:13px;margin-bottom:14px">${label(today)} · daily brief</div>`;

  // TODAY
  h+=`<h3 style="margin:16px 0 6px;border-bottom:2px solid ${A};padding-bottom:4px">Today — ${label(today)}</h3>`;
  if(ADB_KEY){
    const s=daySummary(todayFlights);
    h+=`<p style="margin:6px 0"><b>${s.arrivals}</b> arrivals · <b>${s.seats.toLocaleString()}</b> seats · ${s.wb} widebody</p>`;
    if(s.waves.length){ h+=`<p style="margin:6px 0;color:${muted}">Best waves: `+s.waves.map(waveLine).join(" · ")+`</p>`; }
  } else { h+=`<p style="margin:6px 0;color:${muted}">Flights: set AERODATABOX_KEY to include live arrivals.</p>`; }
  if(cruiseToday.length){
    for(const c of cruiseToday){
      h+=`<div style="margin:8px 0;padding:8px 10px;background:#eef6f5;border-left:3px solid ${T};border-radius:6px">
        <b>${esc(c.ship)}</b> <span style="color:${muted}">${esc(c.line||"")}${c.pax?" · ~"+c.pax.toLocaleString()+" pax":""} · ${c.span}</span>`;
      for(const w of c.win) h+=`<div style="font-size:13px;color:${T};font-weight:600">${w}</div>`;
      h+=`</div>`;
    }
  } else { h+=`<p style="margin:6px 0;color:${muted}">No cruise ship in port today.</p>`; }

  // NEXT 7 DAYS
  h+=`<h3 style="margin:20px 0 6px;border-bottom:2px solid ${T};padding-bottom:4px">Next 7 days</h3>`;
  for(let i=1;i<=7;i++){
    const d=hstDate(i), cr=cruiseFor(d, week.calls);
    const ff=week.days[d]||null;
    let line=`<div style="margin:7px 0;padding-bottom:7px;border-bottom:1px solid #eee"><b>${label(d)}</b>`;
    if(ff){ const s=daySummary(ff); line+=` <span style="color:${muted}">— ${s.arrivals} arr · ${s.seats.toLocaleString()} seats${s.wb?" · "+s.wb+" WB":""}</span>`; }
    if(cr.length){ for(const c of cr){ line+=`<div style="color:${T};font-weight:600;font-size:13px">🚢 ${esc(c.ship)} — ${c.span}</div>`; } }
    else if(!ff){ line+=` <span style="color:${muted}">—</span>`; }
    line+=`</div>`; h+=line;
  }
  h+=`<p style="color:${muted};font-size:11px;margin-top:16px">Cruise data: CruiseMapper. Flight data: AeroDataBox. Times HST.</p></div>`;
  return h;
}

async function send(subject, html){
  if(DRY){ console.log("[DRY RUN] To:",EMAIL_TO,"\nSubject:",subject,"\n--- HTML (first 1200 chars) ---\n",html.slice(0,1200)); return; }
  const r=await fetch("https://api.resend.com/emails",{method:"POST",
    headers:{"Authorization":"Bearer "+RESEND_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({from:EMAIL_FROM,to:[EMAIL_TO],subject,html})});
  const t=await r.text();
  if(!r.ok) throw new Error("Resend HTTP "+r.status+" "+t);
  console.log("Sent:",t);
}

async function main(){
  const today=hstDate(0);
  let calls=[]; try{ calls=JSON.parse(readFileSync("data/cruise.json","utf8")).calls||[]; }catch(e){ console.error("cruise.json:",e.message); }

  // week flight cache
  let week={updated:0,days:{},calls};
  try{ const c=JSON.parse(readFileSync(CACHE,"utf8")); week.days=c.days||{}; week.updated=Date.parse(c.updated||"")||0; }catch(e){}
  const stale = !week.updated || (Date.now()-week.updated>CACHE_MAX_AGE) || !week.days[hstDate(3)];
  if(ADB_KEY && stale){
    console.log("Refreshing 7-day flight cache…");
    const days={};
    for(let i=0;i<=7;i++){ const d=hstDate(i); try{ days[d]=await fetchDay(d); console.log(d,days[d].length); }catch(e){ console.error("day",d,e.message); } }
    week.days=days; week.updated=Date.now();
    try{ writeFileSync(CACHE, JSON.stringify({updated:new Date().toISOString(),days},null,1)+"\n"); }catch(e){ console.error("cache write:",e.message); }
  }
  week.calls=calls;

  // today fresh (only if not just fetched above)
  let todayFlights = week.days[today] || [];
  if(ADB_KEY && !stale){ try{ todayFlights=await fetchDay(today); }catch(e){ console.error("today fetch:",e.message); } }

  const cruiseToday=cruiseFor(today, calls);
  const html=buildHTML(today, todayFlights, cruiseToday, week);
  const s=ADB_KEY?daySummary(todayFlights):null;
  const subject="OGG "+label(today)+(s?` · ${s.arrivals} arr, ${s.seats.toLocaleString()} seats`:"")+(cruiseToday.length?` · 🚢 ${cruiseToday[0].ship}`:"");
  await send(subject, html);
}
main().catch(e=>{ console.error(e); process.exit(1); });
