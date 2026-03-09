import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const API = "http://localhost:8000";
const THEME_COLORS = ["#FF4D4D","#FF8C00","#7B61FF","#00C9A7","#00A3FF","#F59E0B","#EC4899","#34D399"];

const REGIONS_META = [
  {id:"US",x:22,y:38},{id:"EU",x:48,y:28},{id:"UK",x:44,y:25},
  {id:"JP",x:79,y:34},{id:"ASIA",x:76,y:42},{id:"ME",x:59,y:46},
  {id:"EM",x:35,y:63},{id:"CN",x:74,y:38},{id:"LATAM",x:28,y:58},
];

// ─── API LAYER ────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...opts,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

const api = {
  themes:       () => apiFetch("/api/themes"),
  themeDetail:  (id) => apiFetch(`/api/themes/${id}`),
  brief:        () => apiFetch("/api/brief"),
  heatmap:      () => apiFetch("/api/heatmap"),
  alerts:       () => apiFetch("/api/alerts?limit=20"),
  narratives:   () => apiFetch("/api/narratives"),
  chat:         (q) => apiFetch("/api/chat", { method:"POST", body:JSON.stringify({question:q}) }),
  chain:        (e,r) => apiFetch("/api/chain-reaction", { method:"POST", body:JSON.stringify({event_description:e, region:r||null}) }),
  ingest:       () => apiFetch("/api/admin/ingest", { method:"POST" }),
  health:       () => apiFetch("/api/admin/health"),
  calendar:     (days) => apiFetch(`/api/calendar?days_back=${days||60}&days_forward=30`),
  search:       (q, region) => apiFetch(`/api/search?q=${encodeURIComponent(q)}${region?`&region=${region}`:""}&limit=30`),
};

// Assign stable deterministic color to theme based on ID hash (not list position)
function stableColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) & 0xFFFFFFFF;
  return THEME_COLORS[Math.abs(h) % THEME_COLORS.length];
}

function themeColor(t) {
  return t.color || stableColor(t.id);
}

// ─── TINY PRIMITIVES ─────────────────────────────────────────────────────────
function Sparkline({ data, color, width=80, height=32 }) {
  if (!data?.length) return <div style={{width,height}} />;
  const max=Math.max(...data), min=Math.min(...data), range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*width},${height-((v-min)/range)*height}`).join(" ");
  const gid=`g${color.replace(/\W/g,"")}${width}`;
  return (
    <svg width={width} height={height} style={{overflow:"visible"}}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill={`url(#${gid})`}/>
    </svg>
  );
}

function ScoreMeter({ score, color }) {
  const r=20,cx=26,cy=26,circ=2*Math.PI*r;
  return (
    <svg width={52} height={52} style={{flexShrink:0}}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4"/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={circ} strokeDashoffset={circ*(1-Math.min(score,100)/100)} strokeLinecap="round"
        style={{transform:"rotate(-90deg)",transformOrigin:`${cx}px ${cy}px`,transition:"stroke-dashoffset 0.8s ease"}}/>
      <text x={cx} y={cy+5} textAnchor="middle" fill="white" fontSize="11" fontWeight="700" fontFamily="'DM Mono',monospace">{Math.round(score)}</text>
    </svg>
  );
}

function StatusBadge({ status }) {
  const cfg={
    hot:{label:"HOT",bg:"rgba(255,77,77,0.15)",border:"rgba(255,77,77,0.4)",text:"#FF4D4D"},
    cooling:{label:"COOLING",bg:"rgba(0,201,167,0.15)",border:"rgba(0,201,167,0.4)",text:"#00C9A7"},
    stable:{label:"STABLE",bg:"rgba(0,163,255,0.15)",border:"rgba(0,163,255,0.4)",text:"#00A3FF"},
  }[status]||{label:"?",bg:"rgba(255,255,255,0.05)",border:"rgba(255,255,255,0.2)",text:"white"};
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"2px 8px",borderRadius:3,background:cfg.bg,border:`1px solid ${cfg.border}`,fontSize:10,fontWeight:700,color:cfg.text,letterSpacing:"0.08em",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>
      <span style={{width:5,height:5,borderRadius:"50%",background:cfg.text,animation:status==="hot"?"pulse 1.5s infinite":"none"}}/>
      {cfg.label}
    </span>
  );
}

function SeverityDot({ severity }) {
  const c={critical:"#FF4D4D",high:"#FF8C00",medium:"#F59E0B",low:"#00C9A7"}[severity]||"#888";
  return <span style={{width:7,height:7,borderRadius:"50%",background:c,display:"inline-block",flexShrink:0,animation:severity==="critical"?"pulse 1s infinite":"none"}}/>;
}

function Pill({ label, color }) {
  return <span style={{fontSize:10,padding:"1px 7px",borderRadius:10,background:`${color}18`,color,border:`1px solid ${color}35`,fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>{label}</span>;
}

function Skeleton({ w="100%", h=14, r=4 }) {
  return <div style={{width:w,height:h,borderRadius:r,background:"rgba(255,255,255,0.07)",animation:"shimmer 1.5s infinite",flexShrink:0}}/>;
}

function Panel({ children, style={} }) {
  return <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,...style}}>{children}</div>;
}

function PanelHeader({ label, sub, right }) {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
      <div>
        <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.45)",letterSpacing:"0.1em",fontFamily:"'DM Mono',monospace"}}>{label}</div>
        {sub && <div style={{fontSize:11,color:"rgba(255,255,255,0.25)",marginTop:2}}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// ─── NAV TABS ─────────────────────────────────────────────────────────────────
const NAV_TABS = [
  {id:"dashboard", icon:"◎", label:"Dashboard"},
  {id:"chat",      icon:"◈", label:"Analyst AI"},
  {id:"chain",     icon:"⬡", label:"Chain Reaction"},
  {id:"alerts",    icon:"◉", label:"Alerts"},
  {id:"narratives",icon:"◆", label:"Narratives"},
  {id:"calendar",  icon:"▦", label:"Calendar"},
  {id:"search",    icon:"⌕", label:"Search"},
];

// ─── THEME CARD ───────────────────────────────────────────────────────────────
function ThemeCard({ theme, color, onClick, isSelected }) {
  const [hov,setHov]=useState(false);
  const sparkline = theme.sparkline || [];
  return (
    <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{padding:"13px 15px",borderRadius:8,cursor:"pointer",transition:"all 0.18s",
        border:`1px solid ${isSelected?color+"70":"rgba(255,255,255,0.07)"}`,
        background:isSelected?`${color}12`:hov?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.02)",
        display:"flex",alignItems:"center",gap:13}}>
      <ScoreMeter score={theme.score} color={color}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
          <span style={{color:"white",fontSize:13,fontWeight:600,fontFamily:"'Syne',sans-serif"}}>{theme.name}</span>
          <StatusBadge status={theme.status}/>
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {(theme.regions||[]).map(r=><span key={r} style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.4)",fontFamily:"'DM Mono',monospace"}}>{r}</span>)}
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
        <Sparkline data={sparkline} color={color}/>
        <span style={{fontSize:10,color:(theme.delta||0)>=0?"#4ADE80":"#FF4D4D",fontFamily:"'DM Mono',monospace",fontWeight:600}}>
          {(theme.delta||0)>=0?"▲":"▼"}{Math.abs(theme.delta||0).toFixed(0)}
        </span>
      </div>
    </div>
  );
}

// ─── THEME DETAIL ─────────────────────────────────────────────────────────────
function ThemeDetail({ theme, color, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); setDetail(null);
    api.themeDetail(theme.id)
      .then(d => { setDetail(d); setLoading(false); })
      .catch(() => { setDetail(theme); setLoading(false); });
  }, [theme.id]);

  const d = detail || theme;

  return (
    <div style={{padding:18,height:"100%",overflowY:"auto"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6,flexWrap:"wrap"}}>
            <h2 style={{margin:0,fontSize:20,fontWeight:700,fontFamily:"'Syne',sans-serif",color:"white"}}>{theme.name}</h2>
            <StatusBadge status={theme.status}/>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {(theme.regions||[]).map(r=><Pill key={r} label={r} color={color}/>)}
          </div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.5)",width:30,height:30,borderRadius:6,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
      </div>

      {loading && <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,padding:"8px 12px",background:"rgba(123,97,255,0.1)",border:"1px solid rgba(123,97,255,0.3)",borderRadius:6}}>
        <div style={{width:8,height:8,border:"2px solid #7B61FF",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/><span style={{fontSize:11,color:"#7B61FF",fontFamily:"'DM Mono',monospace"}}>LOADING LIVE DATA...</span>
      </div>}

      {/* Sparkline */}
      <Panel style={{padding:14,marginBottom:12}}>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Mono',monospace",marginBottom:10,letterSpacing:"0.06em"}}>TREND — 8D</div>
        <Sparkline data={theme.sparkline||[]} color={color} width={300} height={52}/>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
          <span style={{fontSize:9,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Mono',monospace"}}>-7d</span>
          <span style={{fontSize:9,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Mono',monospace"}}>today</span>
        </div>
      </Panel>

      {/* Key data chips */}
      {!loading && (d.key_data_points||d.keyDataPoints||[]).length > 0 && (
        <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:12}}>
          {(d.key_data_points||d.keyDataPoints||[]).map((dp,i)=>(
            <div key={i} style={{padding:"4px 10px",borderRadius:4,background:`${color}12`,border:`1px solid ${color}35`,fontSize:10,color,fontFamily:"'DM Mono',monospace"}}>{dp}</div>
          ))}
        </div>
      )}

      {/* Summary */}
      <Panel style={{padding:14,marginBottom:12}}>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Mono',monospace",marginBottom:8,letterSpacing:"0.06em"}}>ANALYST SUMMARY</div>
        {loading ? <div style={{display:"flex",flexDirection:"column",gap:6}}><Skeleton/><Skeleton w="88%"/><Skeleton w="70%"/></div>
          : <p style={{margin:0,fontSize:13,color:"rgba(255,255,255,0.75)",lineHeight:1.7}}>{d.latest_summary||d.summary||"No summary available."}</p>}
      </Panel>

      {/* Risk implications */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Mono',monospace",marginBottom:9,letterSpacing:"0.06em"}}>AI RISK IMPLICATIONS</div>
        {loading ? <div style={{display:"flex",flexDirection:"column",gap:7}}>{[1,2,3].map(i=><Skeleton key={i} h={65} r={6}/>)}</div>
          : <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {(d.risk_implications||d.riskImplications||[]).map((ri,i)=>(
              <Panel key={i} style={{padding:"11px 13px",display:"flex",gap:11,alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                    <span style={{fontSize:13,fontWeight:600,color:"white"}}>{ri.asset}</span>
                    <span style={{fontSize:10,fontWeight:700,fontFamily:"'DM Mono',monospace",color:ri.direction==="bullish"?"#4ADE80":ri.direction==="bearish"?"#FF4D4D":"#F59E0B"}}>
                      {ri.direction==="bullish"?"▲ BULLISH":ri.direction==="bearish"?"▼ BEARISH":"◆ VOLATILE"}
                    </span>
                  </div>
                  <p style={{margin:0,fontSize:12,color:"rgba(255,255,255,0.5)",lineHeight:1.55}}>{ri.rationale}</p>
                </div>
                <div style={{textAlign:"right",minWidth:44}}>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Mono',monospace",marginBottom:2}}>CONF.</div>
                  <div style={{fontSize:16,fontWeight:700,fontFamily:"'DM Mono',monospace",color:ri.confidence>80?"#4ADE80":ri.confidence>65?"#F59E0B":"#FF4D4D"}}>{ri.confidence}%</div>
                </div>
              </Panel>
            ))}
          </div>}
      </div>

      {/* Articles */}
      <div>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Mono',monospace",marginBottom:9,letterSpacing:"0.06em"}}>EVIDENCE</div>
        {loading ? <div style={{display:"flex",flexDirection:"column",gap:6}}>{[1,2,3].map(i=><Skeleton key={i} h={36} r={6}/>)}</div>
          : <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {(d.recent_articles||d.articles||[]).map((a,i)=>{
              const title = typeof a === "string" ? a : a.title;
              const src   = typeof a === "string" ? null : a.source;
              return (
                <div key={i} style={{padding:"9px 12px",borderRadius:6,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",display:"flex",alignItems:"flex-start",gap:10,transition:"border-color 0.15s",cursor:"default"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=`${color}50`}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.06)"}>
                  <span style={{fontSize:10,color:color,fontFamily:"'DM Mono',monospace",fontWeight:700,flexShrink:0}}>[{String(i+1).padStart(2,"0")}]</span>
                  <div>
                    <div style={{fontSize:12,color:"rgba(255,255,255,0.65)"}}>{title}</div>
                    {src && <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginTop:2,fontFamily:"'DM Mono',monospace"}}>{src}</div>}
                  </div>
                </div>
              );
            })}
          </div>}
      </div>
    </div>
  );
}

// ─── FALLBACK DATA (shown when backend is offline) ───────────────────────────
const FALLBACK_THEMES = [
  {id:"1",name:"Sticky Inflation",status:"hot",score:88,delta:11,velocity:4.2,sentiment_avg:-0.35,mention_count_7d:29,regions:["US","EU","UK"],asset_classes:["Bonds","TIPS","Gold"],tags:["inflation"],sparkline:[44,50,55,61,67,74,81,88],updated_at:new Date().toISOString()},
  {id:"2",name:"Oil Supply Shock",status:"hot",score:81,delta:19,velocity:3.8,sentiment_avg:-0.42,mention_count_7d:27,regions:["ME","US","ASIA"],asset_classes:["Energy","Airlines"],tags:["opec"],sparkline:[32,30,38,51,58,65,74,81],updated_at:new Date().toISOString()},
  {id:"3",name:"CB Divergence",status:"hot",score:74,delta:9,velocity:3.1,sentiment_avg:-0.18,mention_count_7d:22,regions:["US","JP","EU"],asset_classes:["FX","Rates"],tags:["fed","boj"],sparkline:[52,55,58,62,65,68,71,74],updated_at:new Date().toISOString()},
  {id:"4",name:"AI Capex Boom",status:"stable",score:68,delta:4,velocity:2.5,sentiment_avg:0.28,mention_count_7d:18,regions:["US","ASIA"],asset_classes:["Tech","Utilities"],tags:["ai"],sparkline:[56,59,61,63,64,66,67,68],updated_at:new Date().toISOString()},
  {id:"5",name:"Geopolitical Flashpoints",status:"hot",score:85,delta:16,velocity:4.5,sentiment_avg:-0.55,mention_count_7d:31,regions:["ME","EU","ASIA"],asset_classes:["Defense","Gold"],tags:["geopolitics"],sparkline:[40,44,52,60,68,74,80,85],updated_at:new Date().toISOString()},
  {id:"6",name:"China Stabilization",status:"cooling",score:51,delta:-7,velocity:1.8,sentiment_avg:-0.12,mention_count_7d:13,regions:["CN","ASIA","EM"],asset_classes:["EM Equities","Commodities"],tags:["china"],sparkline:[68,65,62,58,55,53,52,51],updated_at:new Date().toISOString()},
];
const FALLBACK_BRIEF = {
  bullets:["Fed holds at 5.25–5.50% with dot plot revised to signal only two cuts in 2025 — 10Y Treasury yields back above 4.5%.","OPEC+ extends 2.2mb/d production cuts through Q2; Brent crude breaks $92/bbl as IEA warns of supply deficit.","BOJ historic pivot ends NIRP era; USD/JPY surges to 152 triggering verbal intervention from Japan's MoF.","NATO summit concludes with 22 of 32 members at or above 2% GDP defense spend; European defense stocks at multi-year highs.","US AI infrastructure capex commitments hit $215B for 2025 as power grid constraints emerge as binding bottleneck."],
  narrative_summary:"Global markets navigating persistent inflation, energy supply squeeze, and elevated geopolitical risk across multiple flashpoints.",
  top_theme_ids:[],date:new Date().toISOString(),generated_at:new Date().toISOString()
};
const FALLBACK_HEATMAP = {
  regions:[
    {region:"ME",heat_score:88,hot_theme_count:2,top_themes:["Geopolitical Flashpoints","Oil Supply Shock"],article_count_7d:45},
    {region:"US",heat_score:82,hot_theme_count:3,top_themes:["Sticky Inflation","CB Divergence"],article_count_7d:89},
    {region:"EU",heat_score:71,hot_theme_count:2,top_themes:["CB Divergence","Geopolitical Flashpoints"],article_count_7d:52},
    {region:"JP",heat_score:68,hot_theme_count:1,top_themes:["CB Divergence"],article_count_7d:28},
    {region:"ASIA",heat_score:63,hot_theme_count:1,top_themes:["AI Capex Boom"],article_count_7d:34},
    {region:"CN",heat_score:51,hot_theme_count:0,top_themes:["China Stabilization"],article_count_7d:22},
    {region:"EM",heat_score:44,hot_theme_count:0,top_themes:["China Stabilization"],article_count_7d:18},
    {region:"UK",heat_score:61,hot_theme_count:1,top_themes:["Sticky Inflation"],article_count_7d:31},
    {region:"LATAM",heat_score:35,hot_theme_count:0,top_themes:[],article_count_7d:10},
  ],
  generated_at:new Date().toISOString()
};

// ─── HEATMAP ──────────────────────────────────────────────────────────────────
function HeatMap({ heatmapData }) {
  const regionMap = {};
  (heatmapData?.regions||[]).forEach(r => { regionMap[r.region] = r; });

  return (
    <div style={{position:"relative",width:"100%",paddingBottom:"46%",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:8,overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0}}>
        <svg viewBox="0 0 100 52" width="100%" height="100%" style={{opacity:0.12}}>
          <path d="M5,22 Q12,18 20,20 Q28,22 35,20 Q42,18 45,22 Q48,26 46,30 Q44,34 40,35 Q36,36 32,34 Q28,32 25,35 Q22,38 18,36 Q14,34 10,36 Q6,38 4,34 Q2,30 5,22Z" fill="rgba(255,255,255,0.5)"/>
          <path d="M42,16 Q50,12 58,14 Q66,16 70,20 Q74,24 72,28 Q70,32 66,34 Q62,36 58,34 Q54,32 50,34 Q46,36 44,32 Q42,28 44,24 Q42,20 42,16Z" fill="rgba(255,255,255,0.5)"/>
          <path d="M68,22 Q75,20 82,22 Q86,24 88,28 Q86,32 82,34 Q78,36 75,34 Q72,32 70,28 Q68,26 68,22Z" fill="rgba(255,255,255,0.5)"/>
          <path d="M55,34 Q60,32 65,34 Q68,38 66,42 Q64,46 60,47 Q56,46 54,42 Q52,38 55,34Z" fill="rgba(255,255,255,0.5)"/>
        </svg>
        {REGIONS_META.map(r=>{
          const data = regionMap[r.id];
          const heat = data ? data.heat_score : 30;
          const color = heat>72?"#FF4D4D":heat>55?"#FF8C00":"#00C9A7";
          return (
            <div key={r.id} style={{position:"absolute",left:`${r.x}%`,top:`${r.y}%`,transform:"translate(-50%,-50%)"}}>
              <div style={{position:"relative",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                {heat>60&&<div style={{position:"absolute",width:18,height:18,borderRadius:"50%",background:color,opacity:0.2,animation:"ripple 2s infinite"}}/>}
                <div style={{width:8,height:8,borderRadius:"50%",background:color,border:"1.5px solid rgba(255,255,255,0.6)",zIndex:1}}/>
                <span style={{fontSize:7,color:"rgba(255,255,255,0.55)",fontFamily:"'DM Mono',monospace"}}>{r.id}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CORRELATION NETWORK ──────────────────────────────────────────────────────
function CorrelationNet({ themes, colorMap, onSelect }) {
  if (!themes.length) return <div style={{padding:20}}><Skeleton h={260} r={8}/></div>;
  const nodes = themes.map((t,i)=>{
    const angle=(i/themes.length)*2*Math.PI-Math.PI/2;
    return {...t, x:160+112*Math.cos(angle), y:160+112*Math.sin(angle), color:colorMap[t.id]};
  });
  const n=themes.length;
  const edges=[[0,1],[0,2],[1,3%n],[2,4%n],[3%n,5%n],[4%n,0]].filter(([a,b])=>a<n&&b<n&&a!==b);
  return (
    <div style={{padding:"14px 16px"}}>
      <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",marginBottom:3}}>CORRELATION NETWORK</div>
      <div style={{fontSize:11,color:"rgba(255,255,255,0.22)",marginBottom:10}}>Click any node to drill down</div>
      <svg viewBox="0 0 320 320" width="100%" height="auto">
        <defs>{themes.map(t=>(
          <radialGradient key={t.id} id={`rg${t.id.replace(/-/g,"")}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={colorMap[t.id]} stopOpacity="0.3"/>
            <stop offset="100%" stopColor={colorMap[t.id]} stopOpacity="0"/>
          </radialGradient>
        ))}</defs>
        {edges.map(([a,b],i)=>(
          <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
        ))}
        <circle cx={160} cy={160} r={32} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
        <text x={160} y={156} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="'DM Mono',monospace">MACRO</text>
        <text x={160} y={168} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="'DM Mono',monospace">SYSTEM</text>
        {nodes.map(nd=>(
          <g key={nd.id} onClick={()=>onSelect(nd)} style={{cursor:"pointer"}}>
            <circle cx={nd.x} cy={nd.y} r={22} fill={`url(#rg${nd.id.replace(/-/g,"")})`}/>
            <circle cx={nd.x} cy={nd.y} r={15} fill={`${nd.color}18`} stroke={nd.color} strokeWidth="1.5"/>
            {nd.status==="hot"&&(
              <circle cx={nd.x} cy={nd.y} r={20} fill="none" stroke={nd.color} strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5">
                <animateTransform attributeName="transform" type="rotate" from={`0 ${nd.x} ${nd.y}`} to={`360 ${nd.x} ${nd.y}`} dur="8s" repeatCount="indefinite"/>
              </circle>
            )}
            <text x={nd.x} y={nd.y+4} textAnchor="middle" fill="white" fontSize="9" fontWeight="600" fontFamily="'DM Mono',monospace">{Math.round(nd.score)}</text>
            <text x={nd.x} y={nd.y+27} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="7.5" fontFamily="'Syne',sans-serif">{nd.name.split(" ")[0]}</text>
          </g>
        ))}
      </svg>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:4}}>
        {themes.slice(0,4).map(t=>(
          <div key={t.id} onClick={()=>onSelect(t)} style={{padding:"8px 10px",borderRadius:6,background:"rgba(255,255,255,0.02)",border:`1px solid ${colorMap[t.id]}28`,cursor:"pointer",transition:"background 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.background=`${colorMap[t.id]}10`}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.02)"}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.6)",fontWeight:600,fontFamily:"'Syne',sans-serif"}}>{t.name.split(" ")[0]}</span>
              <span style={{fontSize:11,fontWeight:700,color:colorMap[t.id],fontFamily:"'DM Mono',monospace"}}>{Math.round(t.score)}</span>
            </div>
            <Sparkline data={t.sparkline||[]} color={colorMap[t.id]} width={118} height={24}/>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CHAT PANEL ───────────────────────────────────────────────────────────────
function ChatPanel() {
  const [messages, setMessages] = useState([
    {role:"assistant", content:"Hello. I'm your Macro Analyst AI. I have access to the platform's full article database and can answer any macroeconomic question with cited evidence.\n\nTry asking: *\"Why is inflation staying elevated?\"* or *\"What risks does rising oil create for EM?\"*"}
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages(prev => [...prev, {role:"user", content:q}]);
    setLoading(true);
    try {
      const data = await api.chat(q);
      const sourcesText = data.sources?.length
        ? "\n\n**Sources:** " + data.sources.map((s,i)=>`[${i+1}] ${s.source} — ${s.title}`).join(" · ")
        : "";
      setMessages(prev => [...prev, {
        role:"assistant",
        content: data.answer + sourcesText,
        confidence: data.confidence,
        themeIds: data.related_theme_ids,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {role:"assistant", content:`⚠ Error: ${e.message}. Is the backend running at ${API}?`}]);
    }
    setLoading(false);
  };

  const renderContent = (text) => {
    return text.split("\n").map((line, i) => {
      const bold = line.replace(/\*\*(.*?)\*\*/g, (_, t) => `<strong>${t}</strong>`);
      const italic = bold.replace(/\*(.*?)\*/g, (_, t) => `<em>${t}</em>`);
      return <p key={i} style={{margin:"3px 0",lineHeight:1.6}} dangerouslySetInnerHTML={{__html:italic||"&nbsp;"}}/>;
    });
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",gap:0}}>
      <PanelHeader label="MACRO ANALYST AI" sub="RAG-powered · grounded in platform articles"/>
      <div style={{flex:1,overflowY:"auto",padding:"16px",display:"flex",flexDirection:"column",gap:12}}>
        {messages.map((m,i)=>(
          <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",animation:"fadeIn 0.2s ease"}}>
            <div style={{width:28,height:28,borderRadius:6,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,
              background:m.role==="user"?"rgba(123,97,255,0.25)":"rgba(255,255,255,0.06)",
              border:`1px solid ${m.role==="user"?"rgba(123,97,255,0.4)":"rgba(255,255,255,0.1)"}`}}>
              {m.role==="user"?"U":"AI"}
            </div>
            <div style={{flex:1,background:m.role==="user"?"rgba(123,97,255,0.08)":"rgba(255,255,255,0.02)",border:`1px solid ${m.role==="user"?"rgba(123,97,255,0.2)":"rgba(255,255,255,0.06)"}`,borderRadius:8,padding:"10px 13px"}}>
              <div style={{fontSize:13,color:m.role==="user"?"rgba(255,255,255,0.85)":"rgba(255,255,255,0.75)"}}>{renderContent(m.content)}</div>
              {m.confidence && <div style={{marginTop:6,fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Mono',monospace"}}>CONFIDENCE: {Math.round(m.confidence*100)}%</div>}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
            <div style={{width:28,height:28,borderRadius:6,flexShrink:0,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>AI</div>
            <div style={{padding:"12px 14px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:8,height:8,border:"2px solid #7B61FF",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
              <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>Searching knowledge base...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>
      <div style={{padding:"12px 16px",borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",gap:10}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()}
          placeholder="Ask any macro question..."
          style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:7,padding:"10px 14px",color:"white",fontSize:13,fontFamily:"'DM Mono',monospace",outline:"none"}}/>
        <button onClick={send} disabled={loading||!input.trim()} style={{padding:"10px 18px",background:"rgba(123,97,255,0.2)",border:"1px solid rgba(123,97,255,0.45)",color:"#7B61FF",borderRadius:7,cursor:loading?"not-allowed":"pointer",fontSize:12,fontFamily:"'DM Mono',monospace",fontWeight:700,opacity:loading?0.5:1,transition:"all 0.15s"}}>
          SEND →
        </button>
      </div>
    </div>
  );
}

// ─── CHAIN REACTION PANEL ─────────────────────────────────────────────────────
function ChainPanel() {
  const [eventInput, setEventInput] = useState("");
  const [regionInput, setRegionInput] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const EXAMPLES = [
    "OPEC cuts production by 2 million barrels per day",
    "Federal Reserve raises rates by 75bps unexpectedly",
    "China property sector default cascade begins",
    "Major cyberattack disrupts US financial infrastructure",
  ];

  const run = async () => {
    if (!eventInput.trim() || loading) return;
    setLoading(true); setResult(null); setError(null);
    try {
      const data = await api.chain(eventInput.trim(), regionInput.trim()||null);
      setResult(data);
    } catch(e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const TIMEFRAME_COLOR = {immediate:"#FF4D4D", days:"#FF8C00", weeks:"#F59E0B", months:"#00C9A7", quarters:"#00A3FF"};

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PanelHeader label="CHAIN REACTION SIMULATOR" sub="AI predicts macro ripple effects from any event"/>
      <div style={{flex:1,overflowY:"auto",padding:16}}>
        {/* Input */}
        <Panel style={{padding:16,marginBottom:16}}>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Mono',monospace",marginBottom:10,letterSpacing:"0.06em"}}>EVENT DESCRIPTION</div>
          <textarea value={eventInput} onChange={e=>setEventInput(e.target.value)}
            placeholder="Describe a macro event to simulate..."
            style={{width:"100%",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,padding:"10px 12px",color:"white",fontSize:13,fontFamily:"'DM Mono',monospace",resize:"vertical",minHeight:70,outline:"none",boxSizing:"border-box"}}/>
          <div style={{display:"flex",gap:10,marginTop:10,alignItems:"center"}}>
            <input value={regionInput} onChange={e=>setRegionInput(e.target.value)}
              placeholder="Region (optional)"
              style={{flex:1,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,padding:"8px 12px",color:"white",fontSize:12,fontFamily:"'DM Mono',monospace",outline:"none"}}/>
            <button onClick={run} disabled={loading||!eventInput.trim()} style={{padding:"9px 20px",background:"rgba(255,77,77,0.15)",border:"1px solid rgba(255,77,77,0.4)",color:"#FF4D4D",borderRadius:6,cursor:loading?"not-allowed":"pointer",fontSize:11,fontFamily:"'DM Mono',monospace",fontWeight:700,opacity:loading?0.5:1,whiteSpace:"nowrap"}}>
              {loading ? "SIMULATING..." : "⬡ RUN SIMULATION"}
            </button>
          </div>
          <div style={{marginTop:12}}>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Mono',monospace",marginBottom:7}}>EXAMPLES:</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {EXAMPLES.map((ex,i)=>(
                <button key={i} onClick={()=>setEventInput(ex)} style={{fontSize:10,padding:"4px 10px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.5)",borderRadius:4,cursor:"pointer",fontFamily:"'DM Mono',monospace",textAlign:"left"}}>
                  {ex.slice(0,40)}...
                </button>
              ))}
            </div>
          </div>
        </Panel>

        {error && <div style={{padding:"10px 14px",background:"rgba(255,77,77,0.08)",border:"1px solid rgba(255,77,77,0.3)",borderRadius:7,color:"#FF4D4D",fontSize:12,marginBottom:12}}>⚠ {error}</div>}

        {loading && (
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {[1,2,3,4].map(i=><Skeleton key={i} h={100} r={8}/>)}
          </div>
        )}

        {result && !loading && (
          <div style={{animation:"fadeIn 0.3s ease"}}>
            <Panel style={{padding:"12px 16px",marginBottom:14,borderLeft:"3px solid #FF4D4D",borderRadius:"0 8px 8px 0"}}>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Mono',monospace",marginBottom:6,letterSpacing:"0.06em"}}>EVENT SUMMARY</div>
              <p style={{margin:0,fontSize:13,color:"rgba(255,255,255,0.75)",lineHeight:1.65}}>{result.summary}</p>
            </Panel>

            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {(result.steps||[]).map((step,i)=>(
                <div key={i} style={{display:"flex",gap:12}}>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:0}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:"rgba(255,77,77,0.15)",border:"2px solid rgba(255,77,77,0.4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#FF4D4D",fontFamily:"'DM Mono',monospace",flexShrink:0}}>{step.step}</div>
                    {i<(result.steps.length-1)&&<div style={{width:2,flex:1,background:"rgba(255,77,77,0.15)",marginTop:4}}/>}
                  </div>
                  <Panel style={{flex:1,padding:"12px 14px",marginBottom:0}}>
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:6,gap:8}}>
                      <div>
                        <div style={{fontSize:12,color:"rgba(255,255,255,0.45)",fontFamily:"'DM Mono',monospace",marginBottom:3}}>CAUSE → EFFECT</div>
                        <div style={{fontSize:13,fontWeight:600,color:"white",lineHeight:1.4}}>{step.cause} <span style={{color:"rgba(255,255,255,0.3)"}}>→</span> {step.effect}</div>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,flexShrink:0}}>
                        <span style={{fontSize:9,padding:"2px 7px",borderRadius:3,background:`${TIMEFRAME_COLOR[step.timeframe]||"#888"}20`,color:TIMEFRAME_COLOR[step.timeframe]||"#888",border:`1px solid ${TIMEFRAME_COLOR[step.timeframe]||"#888"}40`,fontFamily:"'DM Mono',monospace",fontWeight:700,letterSpacing:"0.06em"}}>{(step.timeframe||"").toUpperCase()}</span>
                        <span style={{fontSize:10,color:step.confidence>75?"#4ADE80":step.confidence>55?"#F59E0B":"#FF4D4D",fontFamily:"'DM Mono',monospace"}}>{step.confidence}% conf.</span>
                      </div>
                    </div>
                    <p style={{margin:"0 0 8px",fontSize:12,color:"rgba(255,255,255,0.45)",lineHeight:1.5,fontStyle:"italic"}}>{step.mechanism}</p>
                    {step.asset_impacts?.length>0 && (
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {step.asset_impacts.map((ai,j)=>(
                          <span key={j} style={{fontSize:10,padding:"2px 8px",borderRadius:3,fontFamily:"'DM Mono',monospace",fontWeight:600,
                            background:ai.direction==="bullish"?"rgba(74,222,128,0.1)":ai.direction==="bearish"?"rgba(255,77,77,0.1)":"rgba(245,158,11,0.1)",
                            color:ai.direction==="bullish"?"#4ADE80":ai.direction==="bearish"?"#FF4D4D":"#F59E0B",
                            border:`1px solid ${ai.direction==="bullish"?"rgba(74,222,128,0.25)":ai.direction==="bearish"?"rgba(255,77,77,0.25)":"rgba(245,158,11,0.25)"}`}}>
                            {ai.direction==="bullish"?"▲":ai.direction==="bearish"?"▼":"◆"} {ai.asset}
                          </span>
                        ))}
                      </div>
                    )}
                  </Panel>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ALERTS PANEL ─────────────────────────────────────────────────────────────
function AlertsPanel() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try { setAlerts(await api.alerts()); } catch { setAlerts([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const TYPE_ICON = {velocity_spike:"🔴",cross_region:"🌍",risk_threshold:"⚠️",new_narrative:"◆"};
  const filtered = filter==="all" ? alerts : alerts.filter(a=>a.severity===filter);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PanelHeader
        label="ALERT ENGINE"
        sub={`${alerts.filter(a=>!a.read).length} unread · auto-checks every 15 min`}
        right={
          <button onClick={load} style={{fontSize:10,padding:"5px 12px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.5)",borderRadius:5,cursor:"pointer",fontFamily:"'DM Mono',monospace"}}>
            ↻ REFRESH
          </button>
        }
      />
      <div style={{padding:"10px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",gap:6}}>
        {["all","critical","high","medium"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{fontSize:10,padding:"4px 12px",borderRadius:4,border:"1px solid",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontWeight:600,letterSpacing:"0.06em",transition:"all 0.15s",
            borderColor:filter===f?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.08)",
            background:filter===f?"rgba(255,255,255,0.1)":"transparent",
            color:filter===f?"white":"rgba(255,255,255,0.4)"}}>
            {f.toUpperCase()}
          </button>
        ))}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:16}}>
        {loading ? <div style={{display:"flex",flexDirection:"column",gap:8}}>{[1,2,3,4].map(i=><Skeleton key={i} h={80} r={8}/>)}</div>
        : filtered.length===0 ? (
          <div style={{textAlign:"center",padding:"48px 0",color:"rgba(255,255,255,0.2)",fontSize:13}}>
            <div style={{fontSize:32,marginBottom:12}}>◉</div>
            No alerts matching filter
          </div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {filtered.map(alert=>(
              <Panel key={alert.id} style={{padding:"12px 14px",borderLeft:`3px solid ${alert.severity==="critical"?"#FF4D4D":alert.severity==="high"?"#FF8C00":alert.severity==="medium"?"#F59E0B":"#00C9A7"}`,borderRadius:"0 8px 8px 0"}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                  <SeverityDot severity={alert.severity}/>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                      <span style={{fontSize:13,fontWeight:600,color:"white"}}>{alert.title}</span>
                      {alert.theme_name && <Pill label={alert.theme_name} color="#7B61FF"/>}
                    </div>
                    <p style={{margin:"0 0 6px",fontSize:12,color:"rgba(255,255,255,0.55)",lineHeight:1.5}}>{alert.message}</p>
                    <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Mono',monospace"}}>
                      {new Date(alert.triggered_at).toLocaleString()} · {alert.alert_type.replace(/_/g," ").toUpperCase()}
                    </div>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NARRATIVES PANEL ─────────────────────────────────────────────────────────
function NarrativesPanel({ themes, colorMap }) {
  const [narratives, setNarratives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.narratives()
      .then(d => { setNarratives(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PanelHeader label="MACRO NARRATIVES" sub="AI-detected dominant economic storylines"/>
      <div style={{flex:1,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:12}}>
        {loading && [1,2,3].map(i=><Skeleton key={i} h={130} r={8}/>)}
        {error && <div style={{padding:14,background:"rgba(255,77,77,0.08)",border:"1px solid rgba(255,77,77,0.3)",borderRadius:8,color:"#FF4D4D",fontSize:12}}>⚠ {error}</div>}
        {!loading && !error && narratives.length===0 && (
          <div style={{textAlign:"center",padding:"48px 0",color:"rgba(255,255,255,0.2)",fontSize:13}}>
            <div style={{fontSize:32,marginBottom:12}}>◆</div>
            No narratives detected yet.<br/>Run ingestion to populate data.
          </div>
        )}
        {narratives.map((n,i)=>{
          const color = THEME_COLORS[i%THEME_COLORS.length];
          const barW = Math.round(n.strength||50);
          return (
            <Panel key={n.id||i} style={{padding:"16px 18px",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,width:`${barW}%`,height:3,background:color,opacity:0.6,borderRadius:"8px 0 0 0"}}/>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:8}}>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:"white",fontFamily:"'Syne',sans-serif",marginBottom:4}}>{n.title}</div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {(n.regions||[]).map(r=><Pill key={r} label={r} color={color}/>)}
                  </div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:22,fontWeight:700,color,fontFamily:"'Syne',sans-serif",lineHeight:1}}>{Math.round(n.strength||50)}</div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:"0.08em"}}>STRENGTH</div>
                </div>
              </div>
              <p style={{margin:"0 0 10px",fontSize:13,color:"rgba(255,255,255,0.65)",lineHeight:1.65}}>{n.description}</p>
              {/* Strength bar */}
              <div style={{height:3,borderRadius:2,background:"rgba(255,255,255,0.06)"}}>
                <div style={{height:"100%",borderRadius:2,background:color,width:`${barW}%`,transition:"width 1s ease"}}/>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

// ─── ECONOMIC CALENDAR PANEL ──────────────────────────────────────────────────
function CalendarPanel() {
  const [calData, setCalData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [daysBack, setDaysBack] = useState(60);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.calendar(daysBack);
      setCalData(data);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [daysBack]);

  useEffect(() => { load(); }, [load]);

  const EVENT_TYPE_CONFIG = {
    economic_release: { icon: "📊", color: "#00A3FF", label: "DATA RELEASE" },
    cpi_print: { icon: "📈", color: "#FF4D4D", label: "CPI PRINT" },
    cb_speech: { icon: "🏦", color: "#7B61FF", label: "CENTRAL BANK" },
    geopolitical: { icon: "🌍", color: "#FF8C00", label: "GEOPOLITICAL" },
    default: { icon: "◆", color: "#F59E0B", label: "EVENT" },
  };

  const sortedDates = calData?.events ? Object.keys(calData.events).sort().reverse() : [];

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PanelHeader
        label="ECONOMIC CALENDAR"
        sub={`${calData?.total_count||0} events · last ${daysBack} days`}
        right={
          <div style={{display:"flex",gap:4}}>
            {[30,60,90].map(d=>(
              <button key={d} onClick={()=>setDaysBack(d)} style={{fontSize:10,padding:"4px 10px",borderRadius:4,border:"1px solid",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontWeight:600,
                borderColor:daysBack===d?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.08)",
                background:daysBack===d?"rgba(255,255,255,0.1)":"transparent",
                color:daysBack===d?"white":"rgba(255,255,255,0.4)"
              }}>{d}D</button>
            ))}
          </div>
        }
      />
      <div style={{flex:1,overflowY:"auto",padding:16}}>
        {loading && [1,2,3,4,5].map(i=><Skeleton key={i} h={80} r={8}/>)}
        {error && <div style={{padding:14,background:"rgba(255,77,77,0.08)",border:"1px solid rgba(255,77,77,0.3)",borderRadius:8,color:"#FF4D4D",fontSize:12}}>⚠ {error}</div>}
        {!loading && !error && sortedDates.length===0 && (
          <div style={{textAlign:"center",padding:"48px 0",color:"rgba(255,255,255,0.2)",fontSize:13}}>
            <div style={{fontSize:32,marginBottom:12}}>▦</div>
            No calendar events found.<br/>Run ingestion to populate data.
          </div>
        )}
        {sortedDates.map(dateKey=>{
          const events = calData.events[dateKey];
          const isToday = dateKey === new Date().toISOString().slice(0,10);
          return (
            <div key={dateKey} style={{marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:isToday?"#7B61FF":"rgba(255,255,255,0.5)",fontFamily:"'DM Mono',monospace"}}>
                  {new Date(dateKey+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}
                </div>
                {isToday && <span style={{fontSize:9,padding:"1px 6px",borderRadius:3,background:"rgba(123,97,255,0.2)",color:"#7B61FF",fontWeight:700,fontFamily:"'DM Mono',monospace"}}>TODAY</span>}
                <div style={{flex:1,height:1,background:"rgba(255,255,255,0.06)"}}/>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6,paddingLeft:8}}>
                {events.map((ev,i)=>{
                  const cfg = EVENT_TYPE_CONFIG[ev.event_type] || EVENT_TYPE_CONFIG.default;
                  return (
                    <Panel key={ev.id||i} style={{padding:"10px 14px",borderLeft:`3px solid ${cfg.color}`,borderRadius:"0 8px 8px 0"}}>
                      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                        <span style={{fontSize:16,flexShrink:0}}>{cfg.icon}</span>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                            <span style={{fontSize:13,fontWeight:600,color:"white"}}>{ev.title}</span>
                            <span style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:`${cfg.color}18`,color:cfg.color,fontFamily:"'DM Mono',monospace",fontWeight:700}}>{cfg.label}</span>
                            {ev.region && <Pill label={ev.region} color={cfg.color}/>}
                          </div>
                          {ev.description && <p style={{margin:"0 0 4px",fontSize:12,color:"rgba(255,255,255,0.5)",lineHeight:1.5}}>{ev.description}</p>}
                          <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Mono',monospace"}}>
                            {new Date(ev.occurred_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </Panel>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SEARCH PANEL ─────────────────────────────────────────────────────────────
function SearchPanel({ themes, colorMap }) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const doSearch = async () => {
    if (!query.trim() || loading) return;
    setLoading(true); setError(null);
    try {
      const data = await api.search(query.trim(), region||null);
      setResults(data);
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  const SUGGESTIONS = ["inflation", "oil prices", "interest rate", "AI semiconductor", "China economy", "geopolitical risk"];

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PanelHeader label="ARTICLE SEARCH" sub="Search across all ingested macro articles"/>
      <div style={{padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch()}
            placeholder="Search articles..."
            style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:7,padding:"10px 14px",color:"white",fontSize:13,fontFamily:"'DM Mono',monospace",outline:"none"}}/>
          <select value={region} onChange={e=>setRegion(e.target.value)}
            style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:7,padding:"8px 12px",color:"white",fontSize:11,fontFamily:"'DM Mono',monospace",outline:"none",cursor:"pointer"}}>
            <option value="" style={{background:"#0f1520",color:"white"}}>All Regions</option>
            {["US","EU","UK","JP","CN","ASIA","ME","EM","LATAM"].map(r=>(
              <option key={r} value={r} style={{background:"#0f1520",color:"white"}}>{r}</option>
            ))}
          </select>
          <button onClick={doSearch} disabled={loading||!query.trim()} style={{padding:"10px 18px",background:"rgba(123,97,255,0.2)",border:"1px solid rgba(123,97,255,0.45)",color:"#7B61FF",borderRadius:7,cursor:loading?"not-allowed":"pointer",fontSize:12,fontFamily:"'DM Mono',monospace",fontWeight:700,opacity:loading?0.5:1,whiteSpace:"nowrap"}}>
            ⌕ SEARCH
          </button>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {SUGGESTIONS.map(s=>(
            <button key={s} onClick={()=>{setQuery(s);}} style={{fontSize:10,padding:"3px 8px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.4)",borderRadius:4,cursor:"pointer",fontFamily:"'DM Mono',monospace"}}>{s}</button>
          ))}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:16}}>
        {loading && <div style={{display:"flex",flexDirection:"column",gap:8}}>{[1,2,3,4,5].map(i=><Skeleton key={i} h={90} r={8}/>)}</div>}
        {error && <div style={{padding:14,background:"rgba(255,77,77,0.08)",border:"1px solid rgba(255,77,77,0.3)",borderRadius:8,color:"#FF4D4D",fontSize:12}}>⚠ {error}</div>}
        {!loading && results && results.total===0 && (
          <div style={{textAlign:"center",padding:"48px 0",color:"rgba(255,255,255,0.2)",fontSize:13}}>
            <div style={{fontSize:32,marginBottom:12}}>⌕</div>
            No articles found for "{query}"<br/>Try a different search term.
          </div>
        )}
        {!loading && !results && (
          <div style={{textAlign:"center",padding:"48px 0",color:"rgba(255,255,255,0.2)",fontSize:13}}>
            <div style={{fontSize:32,marginBottom:12}}>⌕</div>
            Search across all ingested articles.<br/>Use the search bar above to get started.
          </div>
        )}
        {results && results.total > 0 && (
          <div style={{animation:"fadeIn 0.2s ease"}}>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Mono',monospace",marginBottom:12}}>{results.total} RESULTS FOR "{results.query}"</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {results.results.map((article,i)=>(
                <Panel key={article.id||i} style={{padding:"12px 14px"}}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600,color:"white",marginBottom:4,lineHeight:1.4}}>
                        <a href={article.url} target="_blank" rel="noopener noreferrer" style={{color:"white",textDecoration:"none"}}>
                          {article.title}
                        </a>
                      </div>
                      {article.snippet && <p style={{margin:"0 0 6px",fontSize:12,color:"rgba(255,255,255,0.45)",lineHeight:1.5}}>{article.snippet.slice(0,180)}...</p>}
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
                        {(article.themes||[]).map(t=>(
                          <span key={t} style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:"rgba(123,97,255,0.15)",color:"#7B61FF",border:"1px solid rgba(123,97,255,0.3)",fontFamily:"'DM Mono',monospace",fontWeight:600}}>{t}</span>
                        ))}
                        {(article.regions||[]).map(r=>(
                          <span key={r} style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.4)",fontFamily:"'DM Mono',monospace"}}>{r}</span>
                        ))}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:12,fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Mono',monospace"}}>
                        <span>{article.source}</span>
                        {article.published_at && <span>{new Date(article.published_at).toLocaleDateString()}</span>}
                        {article.sentiment!==null && <span style={{color:article.sentiment>=0?"#4ADE80":"#FF4D4D"}}>{article.sentiment>=0?"+":""}{article.sentiment?.toFixed(2)} SENT</span>}
                      </div>
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function MacroRadar() {
  const [tab, setTab] = useState("dashboard");
  const [subTab, setSubTab] = useState("themes"); // themes | heatmap in dashboard
  const [themes, setThemes] = useState([]);
  const [brief, setBrief] = useState(null);
  const [heatmapData, setHeatmapData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [time, setTime] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [health, setHealth] = useState(null);
  const [alertCount, setAlertCount] = useState(0);

  // Assign colors once
  const colorMap = {};
  themes.forEach(t => { colorMap[t.id] = themeColor(t); });

  const loadCore = useCallback(async () => {
    setLoading(true);
    try {
      const [th, br, hm, hth] = await Promise.allSettled([
        api.themes(), api.brief(), api.heatmap(), api.health()
      ]);
      // Use live data if available, fall back to seed data gracefully
      setThemes(th.status==="fulfilled" ? th.value : FALLBACK_THEMES);
      setBrief(br.status==="fulfilled" ? br.value : FALLBACK_BRIEF);
      setHeatmapData(hm.status==="fulfilled" ? hm.value : FALLBACK_HEATMAP);
      if (hth.status==="fulfilled") setHealth(hth.value);
      setLastUpdated(new Date());
    } catch(e) {
      // Complete failure - use all fallbacks
      console.warn("Backend unavailable, using demo data:", e);
      setThemes(FALLBACK_THEMES);
      setBrief(FALLBACK_BRIEF);
      setHeatmapData(FALLBACK_HEATMAP);
    }
    setLoading(false);
  }, []);

  const loadAlertCount = useCallback(async () => {
    try {
      const alerts = await api.alerts();
      setAlertCount(alerts.filter(a=>!a.read).length);
    } catch {}
  }, []);

  useEffect(() => {
    loadCore();
    loadAlertCount();
    const t = setInterval(() => setTime(new Date()), 1000);
    const a = setInterval(loadAlertCount, 60000);
    return () => { clearInterval(t); clearInterval(a); };
  }, [loadCore, loadAlertCount]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setSelected(null);
    try { await api.ingest(); } catch {}
    await loadCore();
    setRefreshing(false);
  };

  const hotCount = themes.filter(t=>t.status==="hot").length;
  const avgScore = themes.length ? Math.round(themes.reduce((a,t)=>a+t.score,0)/themes.length) : 0;
  const backendOk = health?.status === "ok";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#060A12;color:white;font-family:'DM Mono',monospace}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.45;transform:scale(1.5)}}
        @keyframes ripple{0%{transform:scale(1);opacity:0.25}100%{transform:scale(2.8);opacity:0}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%{opacity:0.4}50%{opacity:0.7}100%{opacity:0.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        textarea,input{font-family:'DM Mono',monospace}
        textarea::placeholder,input::placeholder{color:rgba(255,255,255,0.25)}
      `}</style>

      <div style={{minHeight:"100vh",background:"#060A12",display:"flex",flexDirection:"column",position:"relative",overflow:"hidden"}}>
        {/* BG grid */}
        <div style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none",backgroundImage:"linear-gradient(rgba(255,255,255,0.016) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.016) 1px,transparent 1px)",backgroundSize:"44px 44px"}}/>
        <div style={{position:"fixed",top:-240,right:-240,width:680,height:680,borderRadius:"50%",background:"radial-gradient(circle,rgba(255,77,77,0.055) 0%,transparent 70%)",pointerEvents:"none",zIndex:0}}/>
        <div style={{position:"fixed",bottom:-220,left:-120,width:560,height:560,borderRadius:"50%",background:"radial-gradient(circle,rgba(123,97,255,0.06) 0%,transparent 70%)",pointerEvents:"none",zIndex:0}}/>

        {/* ── TOP BAR ── */}
        <div style={{position:"relative",zIndex:10,background:"rgba(6,10,18,0.95)",backdropFilter:"blur(16px)",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0}}>
          {/* Row 1: Logo + Stats + Refresh */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 24px 6px"}}>
            {/* Logo */}
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{position:"relative"}}>
                <div style={{width:30,height:30,borderRadius:7,background:"linear-gradient(135deg,#FF4D4D,#7B61FF)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>◎</div>
                <div style={{position:"absolute",top:-2,right:-2,width:7,height:7,borderRadius:"50%",background:backendOk?"#4ADE80":"#FF4D4D",border:"2px solid #060A12",animation:"pulse 2s infinite"}}/>
              </div>
              <div>
                <div style={{fontSize:14,fontWeight:800,fontFamily:"'Syne',sans-serif",letterSpacing:"-0.02em",lineHeight:1.1}}>GLOBAL MACRO RADAR</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.1em",marginTop:1}}>
                  {backendOk
                    ? `LIVE · ${health?.article_count||0} ARTICLES · ${health?.theme_count||0} THEMES`
                    : `DEMO MODE — START BACKEND AT ${API}`}
                </div>
              </div>
            </div>

            {/* Right: Stats + Refresh + Time */}
            <div style={{display:"flex",alignItems:"center",gap:16}}>
              <div style={{display:"flex",gap:14}}>
                {[{v:loading?null:hotCount,l:"HOT",c:"#FF4D4D"},{v:loading?null:avgScore,l:"AVG",c:"#F59E0B"},{v:loading?null:themes.length,l:"THEMES",c:"#4ADE80"}].map(({v,l,c})=>(
                  <div key={l} style={{textAlign:"center"}}>
                    {v===null?<Skeleton w={22} h={16} r={3}/>:<div style={{fontSize:16,fontWeight:700,color:c,fontFamily:"'Syne',sans-serif",lineHeight:1}}>{v}</div>}
                    <div style={{fontSize:7,color:"rgba(255,255,255,0.25)",letterSpacing:"0.08em",marginTop:1}}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{width:1,height:24,background:"rgba(255,255,255,0.08)"}}/>
              <button onClick={handleRefresh} disabled={refreshing||loading} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",background:"rgba(123,97,255,0.12)",border:"1px solid rgba(123,97,255,0.35)",color:"#7B61FF",borderRadius:5,cursor:refreshing?"not-allowed":"pointer",fontSize:10,fontFamily:"'DM Mono',monospace",fontWeight:700,opacity:refreshing?0.5:1,transition:"all 0.2s",letterSpacing:"0.04em"}}>
                <span style={{display:"inline-block",animation:refreshing?"spin 0.9s linear infinite":"none",fontSize:12}}>↻</span>
                {refreshing?"...":"REFRESH"}
              </button>
              <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.02em",color:"rgba(255,255,255,0.5)",fontFamily:"'DM Mono',monospace"}}>
                {time.toLocaleTimeString("en-US",{hour12:false})}
              </div>
            </div>
          </div>

          {/* Row 2: Navigation Tabs */}
          <div style={{padding:"0 24px 8px",display:"flex",gap:4}}>
            {NAV_TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 14px",borderRadius:20,border:"none",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace",fontWeight:600,letterSpacing:"0.03em",transition:"all 0.2s ease",
                background:tab===t.id?"rgba(123,97,255,0.18)":"transparent",
                color:tab===t.id?"#C4B5FF":"rgba(255,255,255,0.35)",
                boxShadow:tab===t.id?"inset 0 0 0 1px rgba(123,97,255,0.35)":"none",
              }}>
                {t.label}
                {t.id==="alerts"&&alertCount>0&&<span style={{minWidth:15,height:15,borderRadius:8,background:"#FF4D4D",color:"white",fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px",marginLeft:1}}>{alertCount}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ── MACRO BRIEF BAR ── */}
        {tab==="dashboard" && (
          <div style={{position:"relative",zIndex:9,background:"rgba(6,10,18,0.85)",borderBottom:"1px solid rgba(255,255,255,0.06)",padding:"0 24px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",padding:"10px 0"}} onClick={()=>setBriefOpen(!briefOpen)}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:10,color:"#7B61FF",fontWeight:700,letterSpacing:"0.09em"}}>TODAY'S MACRO BRIEF</span>
                {!brief ? <div style={{width:10,height:10,border:"1.5px solid #7B61FF",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
                  : <span style={{fontSize:10,color:"rgba(255,255,255,0.22)"}}>{(brief.bullets||[]).length} signals{lastUpdated?` · ${lastUpdated.toLocaleTimeString()}`:""}</span>}
              </div>
              <span style={{fontSize:12,color:"rgba(255,255,255,0.28)",transition:"transform 0.2s",display:"inline-block",transform:briefOpen?"rotate(180deg)":"none"}}>▾</span>
            </div>
            {!briefOpen && brief && (
              <div style={{paddingBottom:10,fontSize:12,color:"rgba(255,255,255,0.5)",lineHeight:1.55}}>{brief.bullets?.[0]||"Loading..."}</div>
            )}
            {briefOpen && brief && (
              <div style={{paddingBottom:14,display:"flex",flexDirection:"column",gap:8,animation:"fadeIn 0.2s ease"}}>
                {(brief.bullets||[]).map((b,i)=>(
                  <div key={i} style={{display:"flex",gap:11}}>
                    <span style={{fontSize:10,color:"#7B61FF",minWidth:20,fontWeight:700,flexShrink:0}}>0{i+1}</span>
                    <span style={{fontSize:12,color:"rgba(255,255,255,0.68)",lineHeight:1.6}}>{b}</span>
                  </div>
                ))}
                {brief.narrative_summary && (
                  <div style={{marginTop:4,paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.06)",fontSize:12,color:"rgba(255,255,255,0.45)",lineHeight:1.6,fontStyle:"italic"}}>{brief.narrative_summary}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── MAIN CONTENT ── */}
        <div style={{flex:1,position:"relative",zIndex:1,overflow:"hidden",display:"flex"}}>

          {/* DASHBOARD TAB */}
          {tab==="dashboard" && (
            <div style={{flex:1,display:"grid",gridTemplateColumns:selected?"1fr 420px":"1fr 400px",gap:0,overflow:"hidden"}}>
              {/* Left */}
              <div style={{overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>
                {/* Sub-tabs */}
                <div style={{display:"flex",gap:2,background:"rgba(255,255,255,0.03)",borderRadius:6,padding:3,width:"fit-content"}}>
                  {["themes","heatmap"].map(t=>(
                    <button key={t} onClick={()=>setSubTab(t)} style={{padding:"5px 16px",borderRadius:4,border:"none",cursor:"pointer",background:subTab===t?"rgba(255,255,255,0.1)":"transparent",color:subTab===t?"white":"rgba(255,255,255,0.38)",fontSize:10,fontFamily:"'DM Mono',monospace",fontWeight:600,letterSpacing:"0.07em",textTransform:"uppercase",transition:"all 0.15s"}}>{t}</button>
                  ))}
                </div>
                {subTab==="heatmap" && <HeatMap heatmapData={heatmapData}/>}
                {loading ? [1,2,3,4,5,6].map(i=>(
                  <div key={i} style={{padding:"13px 15px",borderRadius:8,border:"1px solid rgba(255,255,255,0.07)",background:"rgba(255,255,255,0.02)",display:"flex",alignItems:"center",gap:13}}>
                    <Skeleton w={52} h={52} r={26}/><div style={{flex:1,display:"flex",flexDirection:"column",gap:7}}><Skeleton w="55%" h={13}/><Skeleton w="35%" h={10}/></div><Skeleton w={80} h={32}/>
                  </div>
                )) : themes.map((theme,i)=>(
                  <div key={theme.id} style={{animation:"fadeIn 0.35s ease forwards",animationDelay:`${i*0.05}s`,opacity:0}}>
                    <ThemeCard theme={theme} color={colorMap[theme.id]} onClick={()=>setSelected(selected?.id===theme.id?null:theme)} isSelected={selected?.id===theme.id}/>
                  </div>
                ))}
              </div>

              {/* Right panel */}
              <div style={{borderLeft:"1px solid rgba(255,255,255,0.07)",overflowY:"auto",background:"rgba(255,255,255,0.01)"}}>
                {selected ? (
                  <ThemeDetail theme={selected} color={colorMap[selected.id]} onClose={()=>setSelected(null)}/>
                ) : (
                  <CorrelationNet themes={themes} colorMap={colorMap} onSelect={t=>{setSelected(t);setSubTab("themes");}}/>
                )}
              </div>
            </div>
          )}

          {/* CHAT TAB */}
          {tab==="chat" && (
            <div style={{flex:1,display:"flex",maxWidth:860,margin:"0 auto",width:"100%",padding:"16px 20px"}}>
              <Panel style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
                <ChatPanel/>
              </Panel>
            </div>
          )}

          {/* CHAIN REACTION TAB */}
          {tab==="chain" && (
            <div style={{flex:1,display:"flex",maxWidth:900,margin:"0 auto",width:"100%",padding:"16px 20px"}}>
              <Panel style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
                <ChainPanel/>
              </Panel>
            </div>
          )}

          {/* ALERTS TAB */}
          {tab==="alerts" && (
            <div style={{flex:1,display:"flex",maxWidth:820,margin:"0 auto",width:"100%",padding:"16px 20px"}}>
              <Panel style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
                <AlertsPanel/>
              </Panel>
            </div>
          )}

          {/* NARRATIVES TAB */}
          {tab==="narratives" && (
            <div style={{flex:1,display:"flex",maxWidth:860,margin:"0 auto",width:"100%",padding:"16px 20px"}}>
              <Panel style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
                <NarrativesPanel themes={themes} colorMap={colorMap}/>
              </Panel>
            </div>
          )}

          {/* CALENDAR TAB */}
          {tab==="calendar" && (
            <div style={{flex:1,display:"flex",maxWidth:860,margin:"0 auto",width:"100%",padding:"16px 20px"}}>
              <Panel style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
                <CalendarPanel/>
              </Panel>
            </div>
          )}

          {/* SEARCH TAB */}
          {tab==="search" && (
            <div style={{flex:1,display:"flex",maxWidth:900,margin:"0 auto",width:"100%",padding:"16px 20px"}}>
              <Panel style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
                <SearchPanel themes={themes} colorMap={colorMap}/>
              </Panel>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
