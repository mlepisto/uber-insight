// Refreshes data/flights.json with real OGG (PHOG) arrivals from AeroDataBox.
// Runs in GitHub Actions (Node 20+, global fetch). Reads AERODATABOX_KEY from env.
// Writes render-ready flight objects matching the OGG Wave Board engine.
// No key set -> exits 0 without touching the file (board keeps its fallback timetable).

import { readFileSync, writeFileSync } from "node:fs";

const KEY = process.env.AERODATABOX_KEY;
if (!KEY) { console.log("AERODATABOX_KEY not set — leaving data/flights.json untouched."); process.exit(0); }

const HOST = "aerodatabox.p.rapidapi.com";
const OUT = "data/flights.json";
const INTERISLAND = new Set(["HNL","KOA","LIH","ITO","MKK","LNY"]);
const CITY = {HNL:"Honolulu",KOA:"Kona",LIH:"Lihue",ITO:"Hilo",LAX:"Los Angeles",SFO:"San Francisco",SEA:"Seattle",PDX:"Portland",SAN:"San Diego",SJC:"San Jose",OAK:"Oakland",SMF:"Sacramento",LAS:"Las Vegas",PHX:"Phoenix",DEN:"Denver",SLC:"Salt Lake City",DFW:"Dallas",ORD:"Chicago",EWR:"Newark",ANC:"Anchorage",YVR:"Vancouver"};

const pad = n => String(n).padStart(2,"0");
const toMin = t => { const [a,b]=t.split(":").map(Number); return a*60+b; };
const to12hm = m => { const h=Math.floor(m/60), mm=m%60, ap=h>=12?"pm":"am"; return (((h+11)%12)+1)+":"+pad(mm)+ap; };
const to12 = t => { if(!t) return ""; const [h,m]=t.split(":").map(Number); const ap=h>=12?"pm":"am"; return (((h+11)%12)+1)+":"+pad(m)+ap; };

function seatFromModel(m){
  m=(m||"").toLowerCase();
  const wb=/a330|a340|a350|767|777|787|747/.test(m);
  let s=160,name=m||"Aircraft";
  if(/a330/.test(m)){s=278;name="A330";}
  else if(/a350/.test(m)){s=300;name="A350";}
  else if(/787-9|789/.test(m)){s=257;name="787-9";}
  else if(/787|788/.test(m)){s=243;name="787-8";}
  else if(/777/.test(m)){s=290;name="777";}
  else if(/767/.test(m)){s=240;name="767";}
  else if(/a321neo|a21n|a321n/.test(m)){s=189;name="A321neo";}
  else if(/a321/.test(m)){s=190;name="A321";}
  else if(/a320neo|a20n/.test(m)){s=180;name="A320neo";}
  else if(/a320/.test(m)){s=170;name="A320";}
  else if(/a319/.test(m)){s=128;name="A319";}
  else if(/757/.test(m)){s=199;name="757";}
  else if(/717/.test(m)){s=128;name="717";}
  else if(/max\s*9|737-9|7m9/.test(m)){s=178;name="737 MAX 9";}
  else if(/max\s*8|737-8|7m8/.test(m)){s=175;name="737 MAX 8";}
  else if(/737-900|739/.test(m)){s=178;name="737-900";}
  else if(/737-800|738/.test(m)){s=166;name="737-800";}
  else if(/737-700|737-7|73w/.test(m)){s=143;name="737-700";}
  else if(/e175|erj|embraer|175/.test(m)){s=76;name="E175";}
  return {s,wb,name};
}

function parse(arr, isToday){
  const out=[];
  for(const f of arr){
    const mv=f.movement||f.arrival||{};
    const sched=mv.scheduledTime&&(mv.scheduledTime.local||"");
    const revT=mv.revisedTime&&(mv.revisedTime.local||"");
    const runT=mv.runwayTime&&(mv.runwayTime.local||"");
    const predT=mv.predictedTime&&(mv.predictedTime.local||"");
    const eff=runT||revT||predT||sched;
    if(!sched&&!eff) continue;
    const schedHM=(sched||eff).slice(11,16), effHM=(eff||sched).slice(11,16);
    const schedMin=toMin(schedHM), effMin=toMin(effHM);
    const st=(f.status||"").toLowerCase();
    const cancelled=/cancel/.test(st);
    const landed=!!runT||/arriv|landed|onblock|gatearriv/.test(st);
    const ap=mv.airport||{};
    const org=(ap.iata||ap.icao||"").toUpperCase();
    const acm=seatFromModel(f.aircraft&&f.aircraft.model);
    let delay=effMin-schedMin;
    if(delay>720)delay-=1440; if(delay<-720)delay+=1440;
    out.push({
      min:schedMin, effMin:landed?effMin:Math.max(schedMin,effMin), time:schedHM,
      flt:(f.number||"").replace(/\s/g,""),
      carrier:(f.airline&&f.airline.name)||"", org,
      orgName:(CITY[org]||ap.name||org),
      seats:acm.s, wb:acm.wb, cls:acm.wb?"Widebody":"Narrowbody", acname:acm.name,
      inter:INTERISLAND.has(org),
      live:isToday, status:f.status||"", delayMin:Math.round(delay),
      landed, cancelled, etaTxt:to12hm(effMin),
      schedTxt:to12hm(schedMin), landedTxt:landed?to12hm(effMin):null, hasActual:!!runT
    });
  }
  return out.sort((a,b)=>a.effMin-b.effMin);
}

async function fetchWindow(day, from, to){
  const url=`https://${HOST}/flights/airports/icao/PHOG/${day}T${from}/${day}T${to}?direction=Arrival&withLeg=false&withCancelled=true&withCodeshared=false&withLocation=false`;
  const r=await fetch(url,{headers:{"X-RapidAPI-Key":KEY,"X-RapidAPI-Host":HOST}});
  if(!r.ok){ throw new Error(`HTTP ${r.status} ${await r.text().catch(()=>"")}`.slice(0,200)); }
  const j=await r.json();
  return j.arrivals||[];
}

async function main(){
  // Today in Hawai'i time (HST = UTC-10, no DST).
  const hst=new Date(Date.now()-10*3600*1000);
  const day=`${hst.getUTCFullYear()}-${pad(hst.getUTCMonth()+1)}-${pad(hst.getUTCDate())}`;
  let arrivals=[];
  try{
    const [a,b]=await Promise.all([ fetchWindow(day,"00:00","11:59"), fetchWindow(day,"12:00","23:59") ]);
    arrivals=a.concat(b);
  }catch(e){
    console.error("Fetch failed:", e.message);
    process.exit(0); // leave existing file in place rather than clobbering with empty
  }
  const flights=parse(arrivals, true);
  const payload={ airport:"OGG", updated:new Date().toISOString(), day, flights };
  // Only rewrite if the flight set actually changed (avoids empty commits every run).
  let prev=""; try{ prev=readFileSync(OUT,"utf8"); }catch(e){}
  const prevFlights = (()=>{ try{ return JSON.stringify(JSON.parse(prev).flights); }catch(e){ return ""; } })();
  if(JSON.stringify(flights)===prevFlights && prevFlights!==""){
    console.log(`No change (${flights.length} arrivals for ${day}).`);
    return;
  }
  writeFileSync(OUT, JSON.stringify(payload,null,2)+"\n");
  console.log(`Wrote ${flights.length} arrivals for ${day}.`);
}
main();
