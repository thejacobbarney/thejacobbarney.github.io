"""Commissioner dashboard for Circus AI managers.
Protect with DASHBOARD_API_TOKEN. No credentials are rendered or exposed.
"""
import hmac, json, os, pathlib, subprocess, sys
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
ROOT=pathlib.Path(__file__).resolve().parent
app=FastAPI(title="Circus AI Fantasy Manager")
def config(): return json.loads((ROOT/"config/league.json").read_text())
def current_props():
    snap=ROOT/"shared/snapshot.json"
    week=json.loads(snap.read_text()).get("week") if snap.exists() else None
    p=ROOT/"shared/proposals"/f"week{week}.json" if week else None
    return week,p,(json.loads(p.read_text()) if p and p.exists() else [])
def auth(token):
    expected=os.getenv("DASHBOARD_API_TOKEN","")
    # compare bytes: compare_digest raises TypeError (a 500) on non-ASCII str input
    if not expected or not token or not hmac.compare_digest(token.encode(),expected.encode()):
        raise HTTPException(401,"Dashboard token missing or invalid.")
class Decision(BaseModel):
    decision: str
    note: str=""
@app.get("/health")
def health(): return {"ok":True,"service":"circus-ai-fantasy-manager"}
@app.get("/api/status")
def status(x_dashboard_token: str|None=Header(default=None)):
    auth(x_dashboard_token)
    c=config(); week,p,props=current_props()
    return {"league_id": "configured" if os.getenv("LEAGUE_ID") else "missing",
      "season":os.getenv("SEASON","2026"),"paused":c.get("paused",True),
      "execution_mode":c.get("execution",{}).get("mode","unknown"),"week":week,
      "bots":len(c.get("bot_teams",{})),"pending":sum(x.get("status")=="pending" for x in props),
      "assist_teams":len(c.get("assist_teams",{}))}
@app.get("/api/proposals")
def proposals(status_filter: str|None=None, x_dashboard_token: str|None=Header(default=None)):
    auth(x_dashboard_token)
    week,p,props=current_props()
    if status_filter: props=[x for x in props if x.get("status")==status_filter]
    return {"week":week,"proposals":props}
@app.get("/api/espn-check")
def espn_check(x_dashboard_token: str|None=Header(default=None)):
    """Read-only ESPN connectivity check. Never writes to ESPN and never returns credentials."""
    auth(x_dashboard_token)
    missing=[k for k in ("LEAGUE_ID","SEASON","SWID","ESPN_S2") if not os.getenv(k)]
    if missing: return {"ok":False,"error":"missing env vars: "+", ".join(missing)}
    sys.path.insert(0,str(ROOT/"src"))
    try:
        from common import league
        L=league()
        return {"ok":True,"league":L.settings.name,"week":L.current_week,"teams":len(L.teams),
                "read_only":True,"paused":config().get("paused",True)}
    except Exception as e:
        # espn-api messages can echo request details; return only the exception type and a hint
        hint="cookies likely expired; refresh SWID/ESPN_S2" if "401" in str(e) or "private" in str(e).lower() else "see service logs"
        print("espn-check failed:",type(e).__name__,e,file=sys.stderr)
        return {"ok":False,"error":type(e).__name__,"hint":hint}
@app.post("/api/proposals/{proposal_id}/review")
def review(proposal_id:str, body:Decision, x_dashboard_token: str|None=Header(default=None)):
    auth(x_dashboard_token)
    if body.decision not in ("approve","reject"): raise HTTPException(400,"decision must be approve or reject")
    week,p,props=current_props()
    if not p or not p.exists(): raise HTTPException(404,"No current-week proposal file.")
    found=next((x for x in props if x.get("id")==proposal_id and x.get("status")=="pending"),None)
    if not found: raise HTTPException(404,"Pending proposal not found.")
    # Approval is a review state only. Actual execution continues through existing controlled CLI flow.
    found["status"]="approved" if body.decision=="approve" else "rejected"
    found["decided_via"]="web_dashboard"
    found["note"]=body.note
    p.write_text(json.dumps(props,indent=1))
    teamdir=next((ROOT/"teams").glob(f"{found.get('team_id')}_*"),None)
    if teamdir:
        with (teamdir/"log.jsonl").open("a") as f: f.write(json.dumps(found)+"\n")
    return {"id":proposal_id,"status":found["status"],"executed":False,
      "message":"Decision recorded. This dashboard does not submit an ESPN transaction."}
@app.post("/api/admin/pause")
def pause(x_dashboard_token: str|None=Header(default=None)):
    auth(x_dashboard_token)
    c=config(); c["paused"]=True
    (ROOT/"config/league.json").write_text(json.dumps(c,indent=1))
    return {"paused":True}
@app.get("/",response_class=HTMLResponse)
def home():
    return HTML
HTML=r"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Circus Fantasy Manager</title><style>
body{margin:0;background:#10131d;color:#f3f5fa;font:15px system-ui}header{padding:24px;background:#171b29;border-bottom:1px solid #30394e}main{max-width:1050px;margin:24px auto;padding:0 16px}h1{margin:0}.muted{color:#a8b1c5}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.card{background:#1a2030;border:1px solid #30394e;border-radius:12px;padding:16px;margin:12px 0}.row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}button,input,select{padding:10px;border-radius:8px;border:1px solid #49536c;background:#252d42;color:white}button{cursor:pointer}.good{color:#5de0c1}.warn{color:#f7d68c}.controls{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.reason{color:#c1c9d9;margin:8px 0}
</style></head><body><header><h1>🏈 Circus AI Fantasy Manager</h1><div class="muted">Commissioner dashboard · league rules remain in control</div></header><main>
<div class="controls"><input id="token" type="password" placeholder="Dashboard API token" autocomplete="current-password"><button onclick="load()">Connect</button><button onclick="pause()">Emergency pause</button></div>
<div class="grid" id="stats"></div><h2>Current week proposals</h2><div class="controls"><select id="filter"><option value="pending">Pending</option><option value="">All statuses</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><button onclick="load()">Refresh</button></div><div id="queue" class="muted">Enter your dashboard token to view proposals.</div>
<p class="muted">Approving/rejecting here records the commissioner's decision only. It does not execute an ESPN transaction. Continue using the existing controlled CLI for execution.</p></main>
<script>
const token=()=>document.getElementById('token').value;
async function req(url,opts={}){opts.headers={...(opts.headers||{}),'X-Dashboard-Token':token(),'Content-Type':'application/json'};let r=await fetch(url,opts);let j=await r.json();if(!r.ok)throw Error(j.detail||'Request failed');return j}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function load(){try{let s=await req('/api/status');document.getElementById('stats').innerHTML=[['League','ESPN '+s.league_id],['Week',s.week??'No snapshot'],['AI teams',s.bots],['Pending',s.pending],['System',s.paused?'PAUSED':'ACTIVE'],['Execution',s.execution_mode]].map(x=>`<div class="card"><div class="muted">${x[0]}</div><strong>${esc(x[1])}</strong></div>`).join('');
let data=await req('/api/proposals'+(document.getElementById('filter').value?'?status_filter='+document.getElementById('filter').value:''));let q=document.getElementById('queue');q.innerHTML='';
if(!data.proposals.length){q.textContent='No proposals in this view.';return}
for(let p of data.proposals){let d=document.createElement('div');d.className='card';d.innerHTML=`<div class="row"><strong>${esc(p.id)} · ${esc(p.team||('Team '+p.team_id))} · ${esc(p.type)}</strong><span class="good">${esc(p.status)}</span></div><div class="reason">${esc(p.reason||'No reason recorded.')}</div><div class="muted">${esc(p.add||'')} ${p.drop?'→ '+esc(p.drop):''}</div><div class="controls"><button onclick="decide('${esc(p.id)}','approve')" ${p.status!=='pending'?'disabled':''}>Approve</button><button onclick="decide('${esc(p.id)}','reject')" ${p.status!=='pending'?'disabled':''}>Reject</button></div>`;q.appendChild(d)}
}catch(e){document.getElementById('queue').textContent=e.message}}
async function decide(id,decision){let note=decision==='reject'?(prompt('Reason (optional)')||''):'';try{await req('/api/proposals/'+encodeURIComponent(id)+'/review',{method:'POST',body:JSON.stringify({decision,note})});await load()}catch(e){alert(e.message)}}
async function pause(){if(!confirm('Pause the agent system?'))return;try{await req('/api/admin/pause',{method:'POST'});await load()}catch(e){alert(e.message)}}
</script></body></html>"""
