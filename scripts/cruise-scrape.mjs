// CruiseMapper -> data/cruise.json scraper for Kahului (port 782).
// Runs on GitHub Actions (runners have internet; the dev sandbox does not).
// Fetches the current + next 2 months, parses the schedule table, writes
// one-off dated calls. RECON=1 dumps a schedule HTML chunk to the log instead.
import { readFileSync, writeFileSync } from "node:fs";

const PORT_URL = "https://www.cruisemapper.com/ports/kahului-port-782";
const OUT = "data/cruise.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const pad = n => String(n).padStart(2,"0");
const MON = {january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
             jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};

// Best-known passenger counts (double occupancy) for ships that call Hawai‘i. Unknown -> omitted.
const PAX = {
  "Pride of America":2186,"Ruby Princess":3080,"Crown Princess":3080,"Sapphire Princess":2670,
  "Grand Princess":2600,"Emerald Princess":3080,"Royal Princess":3560,"Sky Princess":3660,
  "Discovery Princess":3660,"Majestic Princess":3560,"Carnival Radiance":2984,"Carnival Miracle":2124,
  "Carnival Luminosa":2260,"ms Zaandam":1432,"Zaandam":1432,"ms Koningsdam":2650,"Koningsdam":2650,
  "ms Noordam":1972,"Noordam":1972,"ms Westerdam":1964,"Westerdam":1964,"ms Eurodam":2104,"Eurodam":2104,
  "Disney Wonder":2400,"Celebrity Solstice":2850,"Celebrity Edge":2918,"Celebrity Eclipse":2850,
  "Norwegian Jewel":2376,"Norwegian Spirit":2018,"Star Princess":2600,"Ovation of the Seas":4180
};

const strip = s => (s||"").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&")
  .replace(/&#0?39;|&rsquo;|&apos;/g,"'").replace(/\s+/g," ").trim();

function ymNow(off){ const h=new Date(Date.now()-10*3600*1000);
  const d=new Date(Date.UTC(h.getUTCFullYear(),h.getUTCMonth()+off,1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`; }

async function getMonth(ym){
  const r = await fetch(`${PORT_URL}?month=${ym}`, { headers:{ "User-Agent":UA, "Accept-Language":"en-US,en" } });
  return { status:r.status, html: await r.text() };
}

// "1 November, 2026" -> {y,m,d}
function fullDate(t){ const m=(t||"").match(/(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/); if(!m) return null;
  const mo=MON[m[2].toLowerCase()]; if(!mo) return null; return {y:+m[3],m:mo,d:+m[1]}; }
const iso = o => `${o.y}-${pad(o.m)}-${pad(o.d)}`;

function parseMonth(html, calls, seen){
  const parts = html.split('<tr class="newDay"'); parts.shift();
  for(const chunk of parts){
    const row = chunk.slice(0, chunk.indexOf("</tr>"));
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>m[1]);
    if(tds.length<4) continue;
    const dm = tds[0].match(/<span>([^<]+)<\/span>/);
    const arrDate = fullDate(dm && dm[1]);
    if(!arrDate) continue;
    const sm = tds[1].match(/ships\/[^"]*"[^>]*>([^<]+)<\/a>/) || tds[1].match(/<a[^>]*>([^<]+)<\/a>/);
    const ship = strip(sm && sm[1]); if(!ship) continue;
    const lm = tds[1].match(/alt="([^"]+)"/);
    const line = lm ? lm[1].replace(/\s*Cruises?\s*cruise line$/i,"").replace(/\s*cruise line$/i,"").trim() : "";
    const arrT = strip(tds[2]).match(/\d{1,2}:\d{2}/); if(!arrT) continue;
    const depTxt = strip(tds[3]);
    const depTime = (depTxt.match(/\d{1,2}:\d{2}/)||[])[0];
    if(!depTime) continue;
    // departure may carry a next-day date: "02 Nov, 18:00"
    let depDate = { ...arrDate };
    const dd = depTxt.match(/(\d{1,2})\s+([A-Za-z]+)/);
    if(dd && MON[dd[2].toLowerCase()]){
      const dmo = MON[dd[2].toLowerCase()];
      depDate = { y: dmo < arrDate.m ? arrDate.y+1 : arrDate.y, m: dmo, d: +dd[1] };
    }
    const key = ship+"|"+iso(arrDate);
    if(seen.has(key)) continue; seen.add(key);
    const call = { ship, line, arr:{date:iso(arrDate), time:arrT[0]}, dep:{date:iso(depDate), time:depTime} };
    if(PAX[ship]) call.pax = PAX[ship];
    calls.push(call);
  }
}

async function recon(){
  const { status, html } = await getMonth(process.env.MONTH || ymNow(0));
  const i = html.indexOf("portItemSchedule");
  console.log("status", status, "bytes", html.length, "table at", i);
  console.log(html.slice(Math.max(0,i-200), i+16000));
}

async function main(){
  if(process.env.RECON){ return recon(); }
  const months = [ymNow(0), ymNow(1), ymNow(2)];
  const calls=[], seen=new Set();
  for(const ym of months){
    try{ const { status, html } = await getMonth(ym);
      if(status!==200){ console.error("skip",ym,"status",status); continue; }
      const before=calls.length; parseMonth(html, calls, seen);
      console.log(ym, "->", calls.length-before, "calls");
    }catch(e){ console.error("fetch failed",ym,e.message); }
  }
  if(!calls.length){ console.error("No calls parsed — leaving cruise.json unchanged."); process.exit(0); }
  calls.sort((a,b)=> a.arr.date.localeCompare(b.arr.date) || a.arr.time.localeCompare(b.arr.time));
  const payload = {
    _comment: "Auto-scraped from CruiseMapper (Kahului port 782) by scripts/cruise-scrape.mjs. Times are Hawai‘i local. pax = typical double-occupancy where known.",
    source: "cruisemapper.com/ports/kahului-port-782",
    updated: new Date().toISOString(),
    calls
  };
  writeFileSync(OUT, JSON.stringify(payload,null,2)+"\n");
  console.log("Wrote", calls.length, "cruise calls to", OUT);
}
main();
