// Rolling 5-day OGG arrival schedule -> data/flights.json (render-ready for the app & email).
// Runs on GitHub Actions. Today is re-fetched each run (baseline day-of status); future days
// are fetched once as they roll into the window and then reused; past days are dropped.
// Browser "Update" still does a fresh day-of pull on top of this for to-the-minute delays.
// Env: AERODATABOX_KEY (required).
import { readFileSync, writeFileSync } from "node:fs";

const KEY = process.env.AERODATABOX_KEY;
if(!KEY){ console.log("No AERODATABOX_KEY — leaving data/flights.json unchanged."); process.exit(0); }
const OUT = "data/flights.json";
const DAYS = 7; // today + next 6

const pad=n=>String(n).padStart(2,"0");
const toMin=t=>{const[a,b]=t.split(":").map(Number);return a*60+b;};
const to12hm=m=>{const h=Math.floor(m/60),mm=m%60,ap=h>=12?"pm":"am";return(((h+11)%12)+1)+":"+pad(mm)+ap;};
const INTER=new Set(["HNL","KOA","LIH","ITO","MKK","LNY"]);
const CITY={HNL:"Honolulu",KOA:"Kona",LIH:"Lihue",ITO:"Hilo",LAX:"Los Angeles",SFO:"San Francisco",SEA:"Seattle",PDX:"Portland",SAN:"San Diego",SJC:"San Jose",OAK:"Oakland",SMF:"Sacramento",LAS:"Las Vegas",PHX:"Phoenix",DEN:"Denver",SLC:"Salt Lake City",DFW:"Dallas",ORD:"Chicago",EWR:"Newark",ANC:"Anchorage",YVR:"Vancouver"};
const CARGO_RE=/fedex|ups|united parcel|cargo|freight|atlas air|kalitta|abx|cargolux|dhl|amerijet|ameriflight/i;
function seatFromModel(m){ m=(m||"").toLowerCase(); const wb=/a330|a340|a350|767|777|787|747/.test(m); let s=160,name=m||"Aircraft";
  if(/a330/.test(m)){s=278;name="A330";}else if(/a350/.test(m)){s=300;name="A350";}else if(/787-9|789/.test(m)){s=257;name="787-9";}
  else if(/787|788/.test(m)){s=243;name="787-8";}else if(/777/.test(m)){s=290;name="777";}else if(/767/.test(m)){s=240;name="767";}
  else if(/a321neo|a21n|a321n/.test(m)){s=189;name="A321neo";}else if(/a321/.test(m)){s=190;name="A321";}
  else if(/a320neo|a20n/.test(m)){s=180;name="A320neo";}else if(/a320/.test(m)){s=170;name="A320";}else if(/a319/.test(m)){s=128;name="A319";}
  else if(/757/.test(m)){s=199;name="757";}else if(/717/.test(m)){s=128;name="717";}
  else if(/max\s*9|737-9|7m9/.test(m)){s=178;name="737 MAX 9";}else if(/max\s*8|737-8|7m8/.test(m)){s=175;name="737 MAX 8";}
  else if(/737-900|739/.test(m)){s=178;name="737-900";}else if(/737-800|738/.test(m)){s=166;name="737-800";}
  else if(/737-700|737-7|73w/.test(m)){s=143;name="737-700";}else if(/e175|erj|embraer|175/.test(m)){s=76;name="E175";}
  return {s,wb,name}; }

function hstDate(off){ const h=new Date(Date.now()-10*3600*1000); const d=new Date(Date.UTC(h.getUTCFullYear(),h.getUTCMonth(),h.getUTCDate()+off));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; }

let QUOTA=null;
function readQuota(r){ const q={}; r.headers.forEach((v,k)=>{ k=k.toLowerCase(); if(k.startsWith("x-ratelimit-")&&k.endsWith("-remaining")) q[k.slice(12,-10)]=v; }); if(Object.keys(q).length) QUOTA=q; }

async function fetchDay(dateStr, isToday){
  const base="https://aerodatabox.p.rapidapi.com/flights/airports/icao/PHOG/";
  const opt="?direction=Arrival&withLeg=false&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false";
  const hdr={headers:{"X-RapidAPI-Key":KEY,"X-RapidAPI-Host":"aerodatabox.p.rapidapi.com"}};
  let raw=[];
  for(const [a,b] of [["00:00","11:59"],["12:00","23:59"]]){
    const r=await fetch(base+dateStr+"T"+a+"/"+dateStr+"T"+b+opt,hdr);
    readQuota(r);
    if(!r.ok) throw new Error("HTTP "+r.status);
    const j=await r.json(); raw=raw.concat(j.arrivals||[]);
  }
  const out=[];
  for(const f of raw){
    const name=(f.airline&&f.airline.name)||""; if(f.isCargo===true||CARGO_RE.test(name)) continue;
    const mv=f.movement||f.arrival||{};
    const sched=mv.scheduledTime&&(mv.scheduledTime.local||"");
    const revT=mv.revisedTime&&(mv.revisedTime.local||""), runT=mv.runwayTime&&(mv.runwayTime.local||""), predT=mv.predictedTime&&(mv.predictedTime.local||"");
    const eff=runT||revT||predT||sched; if(!sched&&!eff) continue;
    const schedHM=(sched||eff).slice(11,16), effHM=(eff||sched).slice(11,16);
    const schedMin=toMin(schedHM), effMin=toMin(effHM);
    const st=(f.status||"").toLowerCase(), cancelled=/cancel/.test(st), landed=!!runT||/arriv|landed|onblock|gatearriv/.test(st);
    const ap=mv.airport||{}, org=(ap.iata||ap.icao||"").toUpperCase(), ac=seatFromModel(f.aircraft&&f.aircraft.model);
    let delay=effMin-schedMin; if(delay>720)delay-=1440; if(delay<-720)delay+=1440;
    out.push({ min:schedMin, effMin:landed?effMin:Math.max(schedMin,effMin), time:schedHM,
      flt:(f.number||"").replace(/\s/g,""), carrier:name, org, orgName:(CITY[org]||ap.name||org),
      seats:ac.s, wb:ac.wb, cls:ac.wb?"Widebody":"Narrowbody", acname:ac.name, inter:INTER.has(org),
      live:!!isToday, status:f.status||"", delayMin:Math.round(delay), landed, cancelled,
      etaTxt:to12hm(effMin), schedTxt:to12hm(schedMin), landedTxt:landed?to12hm(effMin):null, hasActual:!!runT });
  }
  return out.sort((a,b)=>a.effMin-b.effMin);
}

async function main(){
  const today=hstDate(0);
  const want=[]; for(let i=0;i<DAYS;i++) want.push(hstDate(i));
  let prev={}; try{ prev=JSON.parse(readFileSync(OUT,"utf8")).days||{}; }catch(e){}
  const days={}; let calls=0;
  for(const d of want){
    const isToday=d===today;
    if(!isToday && prev[d] && prev[d].length){ days[d]=prev[d]; continue; }   // reuse cached future day
    try{ days[d]=await fetchDay(d, isToday); calls+=2; console.log(d,(isToday?"[today] ":""),days[d].length,"arrivals"); }
    catch(e){ console.error("day",d,e.message); if(prev[d]) days[d]=prev[d]; }
  }
  if(!Object.keys(days).length){ console.error("nothing fetched; leaving file"); process.exit(0); }
  writeFileSync(OUT, JSON.stringify({airport:"OGG",updated:new Date().toISOString(),day:today,days,quota:QUOTA},null,1)+"\n");
  console.log("Wrote",OUT,"| API calls this run:",calls,"| quota:",JSON.stringify(QUOTA));
}
main().catch(e=>{ console.error(e); process.exit(1); });
