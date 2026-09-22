// CruiseMapper -> data/cruise.json scraper for Kahului (port 782).
// Runs on GitHub Actions runners (they have internet; the dev sandbox does not).
// Modes:
//   RECON=1  -> fetch one month, print status + a chunk of the schedule HTML to the log
//              so the parser can be written against the real structure. Writes nothing.
//   (default)-> fetch MONTHS months, parse, write data/cruise.json.
import { writeFileSync } from "node:fs";

const PORT_URL = "https://www.cruisemapper.com/ports/kahului-port-782";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const pad = n => String(n).padStart(2,"0");

function ymNow(offset=0){
  const hst = new Date(Date.now()-10*3600*1000);
  const d = new Date(Date.UTC(hst.getUTCFullYear(), hst.getUTCMonth()+offset, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`;
}

async function getMonth(ym){
  const url = `${PORT_URL}?month=${ym}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en" } });
  const html = await r.text();
  return { status: r.status, html };
}

async function recon(){
  const ym = process.env.MONTH || ymNow();
  const { status, html } = await getMonth(ym);
  console.log(`RECON ${ym} status=${status} bytes=${html.length}`);
  // Find the schedule region and print a window around it.
  const markers = ["schedule", "Arrival", "Departure", "cruise-tracker", "port-schedule", "<table"];
  let idx = -1, hit = "";
  for(const m of markers){ const i = html.toLowerCase().indexOf(m.toLowerCase()); if(i>=0){ idx=i; hit=m; break; } }
  console.log(`first marker "${hit}" at ${idx}`);
  if(idx<0){ console.log(html.slice(0, 4000)); return; }
  const start = Math.max(0, idx-500);
  console.log("----- SCHEDULE HTML CHUNK START -----");
  console.log(html.slice(start, start+18000));
  console.log("----- SCHEDULE HTML CHUNK END -----");
}

if(process.env.RECON){
  recon().catch(e=>{ console.error("recon failed:", e.message); process.exit(1); });
} else {
  console.log("Parser not implemented yet — run with RECON=1 first.");
  process.exit(0);
}
