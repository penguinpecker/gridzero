"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const DARK = new Set([0,1,2,3,4,5,9,10,14,15,19,20,21,22,23,24]);
const OPEN = new Set([11,12,13]);
const LBL = [];
for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) LBL.push(String.fromCharCode(65+r)+(c+1));
const CLAIMED = [7,9,12,13];

function LogoIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" style={{display:"inline-block",verticalAlign:"middle",flexShrink:0}}>
      <defs><linearGradient id={`lg${size}`} x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#3B7BF6"/><stop offset="100%" stopColor="#1652F0"/>
      </linearGradient></defs>
      <rect x="4" y="4" width="72" height="72" rx="16" fill={`url(#lg${size})`}/>
      <line x1="30" y1="4" x2="30" y2="76" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5"/>
      <line x1="50" y1="4" x2="50" y2="76" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5"/>
      <line x1="4" y1="30" x2="76" y2="30" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5"/>
      <line x1="4" y1="50" x2="76" y2="50" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5"/>
      <text x="40" y="56" textAnchor="middle" fontFamily="Orbitron,sans-serif" fontWeight="900" fontSize="48" fill="white" letterSpacing="-2">0</text>
    </svg>
  );
}

function MechCard({ title, children, gold }) {
  return (
    <div style={{padding:24,border:`1px solid ${gold?"rgba(255,215,0,0.2)":"rgba(22,82,240,0.15)"}`,borderRadius:8,background:gold?"rgba(255,215,0,0.03)":"rgba(22,82,240,0.03)",display:"flex",flexDirection:"column",gap:10}}>
      <div style={{fontFamily:"Orbitron,sans-serif",fontSize:12,fontWeight:700,letterSpacing:1,color:gold?"#FFD700":"#e0e8f0"}}>{title}</div>
      {children}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [scanY, setScanY] = useState(0);
  const [winner, setWinner] = useState(-1);
  const [zkStep, setZkStep] = useState(2);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeSuccess, setCodeSuccess] = useState(false);
  const [showCursor, setShowCursor] = useState(true);
  const winIdx = useRef(0);
  const zkIdx = useRef(2);

  useEffect(() => {
    const s1 = setInterval(() => setScanY(p => (p + 1) % 100), 40);
    const s2 = setInterval(() => { winIdx.current = (winIdx.current + 1) % CLAIMED.length; setWinner(CLAIMED[winIdx.current]); }, 1800);
    const s3 = setInterval(() => { zkIdx.current = (zkIdx.current + 1) % 6; setZkStep(zkIdx.current); }, 1000);
    return () => { clearInterval(s1); clearInterval(s2); clearInterval(s3); };
  }, []);

  function formatCode(val) {
    let v = val.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
    if (v.length > 4) v = v.slice(0, 4) + "-" + v.slice(4);
    setCode(v); setCodeError("");
  }

  function redeemCode() {
    if (!code || code.length < 9) { setCodeError("Enter a valid code in XXXX-XXXX format"); return; }
    setCodeLoading(true);
    setTimeout(() => { setCodeLoading(false); setCodeSuccess(true); }, 1200);
  }

  const ZK_STEPS = [
    "Round ends — block timestamp ≥ endTime",
    "Resolver generates Groth16 VRF proof",
    "Kurier optimistic verify — sub-second",
    "resolveRound() called on Base",
    "Winners auto-paid in same transaction",
    "Proof submitted to zkVerify — finalized",
  ];

  const scanBg = `linear-gradient(180deg,transparent ${scanY-2}%,rgba(22,82,240,0.1) ${scanY-1}%,rgba(22,82,240,0.3) ${scanY}%,rgba(22,82,240,0.1) ${scanY+1}%,transparent ${scanY+2}%)`;

  return (
    <div style={{fontFamily:"'JetBrains Mono',monospace",background:"radial-gradient(ellipse at 30% 0%,#0D1A30 0%,#080E1C 45%,#060A14 100%)",minHeight:"100vh",color:"#c8d6e5",position:"relative"}}>
      {/* CRT + scan */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:1,background:"repeating-linear-gradient(0deg,transparent 0px,transparent 2px,rgba(0,0,0,0.07) 2px,rgba(0,0,0,0.07) 4px)"}}/>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:2,transition:"background 0.04s linear",background:scanBg}}/>

      {/* Header */}
      <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 24px",borderBottom:"1px solid rgba(22,82,240,0.12)",background:"rgba(6,10,20,0.96)",zIndex:100,position:"sticky",top:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <LogoIcon size={28}/>
          <span style={{fontFamily:"Orbitron,sans-serif",fontWeight:900,fontSize:18,color:"#3B7BF6",letterSpacing:3}}>GRID</span>
          <span style={{fontFamily:"Orbitron,sans-serif",fontWeight:500,fontSize:18,color:"#e0e8f0",letterSpacing:2}}>ZERO</span>
          <span style={{fontSize:9,padding:"2px 7px",borderRadius:3,background:"rgba(22,82,240,0.12)",color:"#3B7BF6",letterSpacing:1.5,fontWeight:700}}>BASE · MAINNET</span>
        </div>
        <button onClick={() => router.push("/play")} style={{fontFamily:"Orbitron,sans-serif",fontSize:11,fontWeight:700,padding:"8px 18px",borderRadius:6,border:"none",background:"linear-gradient(135deg,#1652F0,#3B7BF6)",color:"#fff",cursor:"pointer",letterSpacing:1}}>PLAY NOW →</button>
      </header>

      {/* Hero */}
      <section style={{position:"relative",zIndex:5}}>
        <div style={{maxWidth:1000,margin:"0 auto",padding:"0 24px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:60,alignItems:"flex-start",padding:"80px 0 60px"}}>
            {/* Left */}
            <div style={{display:"flex",flexDirection:"column",gap:24}}>
              <div style={{fontSize:10,letterSpacing:3,color:"#3B7BF6",fontWeight:700}}>● LIVE ON BASE MAINNET</div>
              <div style={{fontFamily:"Orbitron,sans-serif",fontSize:42,fontWeight:900,lineHeight:1.15,letterSpacing:1}}>
                <div style={{color:"#3B7BF6"}}>ONCHAIN</div>
                <div style={{color:"#e0e8f0"}}>BETTING</div>
              </div>
              <div style={{fontSize:12,color:"#7a8b9e",lineHeight:1.8,maxWidth:380}}>Pick a cell on the 5×5 grid. A Groth16 ZK proof selects the winner from occupied cells only. Winners share the pot — or keep everything if they picked alone.</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {["1 USDC per round","60s rounds","ZK proof every round","Auto-pay on resolve"].map(c=>(
                  <div key={c} style={{fontSize:10,padding:"4px 10px",borderRadius:4,background:"rgba(22,82,240,0.07)",border:"1px solid rgba(22,82,240,0.15)",color:"#7a8b9e",letterSpacing:0.5}}>{c}</div>
                ))}
              </div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <button onClick={() => router.push("/play")} style={{fontFamily:"Orbitron,sans-serif",fontSize:12,fontWeight:700,padding:"14px 28px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#1652F0,#3B7BF6)",color:"#fff",cursor:"pointer",letterSpacing:1,boxShadow:"0 4px 24px rgba(22,82,240,0.3)"}}>PLAY NOW →</button>
                <button onClick={() => document.getElementById("how-section").scrollIntoView({behavior:"smooth"})} style={{fontFamily:"JetBrains Mono,monospace",fontSize:11,padding:"12px 20px",borderRadius:6,border:"1px solid rgba(22,82,240,0.25)",background:"none",color:"#4a5a6e",cursor:"pointer",letterSpacing:1}}>HOW IT WORKS</button>
              </div>
            </div>

            {/* Right */}
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
              {/* Grid */}
              <div style={{position:"relative",padding:12,border:"1px solid rgba(22,82,240,0.18)",borderRadius:10,background:"rgba(8,14,28,0.7)"}}>
                {[["tl","top:0,left:0,borderLeft","borderTop"],["tr","top:0,right:0,borderRight","borderTop"],["bl","bottom:0,left:0,borderLeft","borderBottom"],["br","bottom:0,right:0,borderRight","borderBottom"]].map(([k])=>(
                  <div key={k} style={{position:"absolute",...(k==="tl"?{top:0,left:0,borderLeft:"2px solid rgba(22,82,240,0.5)",borderTop:"2px solid rgba(22,82,240,0.5)"}:k==="tr"?{top:0,right:0,borderRight:"2px solid rgba(22,82,240,0.5)",borderTop:"2px solid rgba(22,82,240,0.5)"}:k==="bl"?{bottom:0,left:0,borderLeft:"2px solid rgba(22,82,240,0.5)",borderBottom:"2px solid rgba(22,82,240,0.5)"}:{bottom:0,right:0,borderRight:"2px solid rgba(22,82,240,0.5)",borderBottom:"2px solid rgba(22,82,240,0.5)"}),width:14,height:14}}/>
                ))}
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5,width:240}}>
                  {LBL.map((lbl,i) => {
                    const isWin = i === winner;
                    const isClaimed = CLAIMED.includes(i) && !isWin;
                    return (
                      <div key={i} style={{aspectRatio:"1",borderRadius:6,border:`1px solid ${isWin?"rgba(255,215,0,0.6)":isClaimed?"rgba(22,82,240,0.55)":DARK.has(i)?"rgba(22,82,240,0.25)":OPEN.has(i)?"rgba(220,235,255,0.22)":"rgba(200,220,255,0.18)"}`,background:DARK.has(i)?"linear-gradient(145deg,#0E2260,#0A1A4A)":OPEN.has(i)?"linear-gradient(145deg,rgba(230,240,255,0.17),rgba(215,230,255,0.12))":"linear-gradient(145deg,rgba(210,225,255,0.13),rgba(190,210,250,0.08))",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,animation:isWin?"winnerGlow 1.5s ease-in-out infinite":"cellAppear 0.4s ease both",animationDelay:`${Math.floor(i/5)*0.06}s`,color:isWin?"#FFD700":isClaimed?"#3B7BF6":DARK.has(i)?"rgba(140,170,220,0.4)":"rgba(210,225,250,0.6)"}}>
                        <span style={{fontSize:9,letterSpacing:1}}>{lbl}</span>
                        <span style={{fontSize:11,opacity:isWin||isClaimed?1:0.2}}>{isWin?"★":isClaimed?"◈":"◇"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{display:"flex",gap:16}}>
                {[["ROUND","#30144"],["POT","4.00 USDC","#3B7BF6"],["PLAYERS","4"]].map(([l,v,vc])=>(
                  <div key={l} style={{fontSize:10,color:"#4a5a6e"}}>{l} <b style={{fontFamily:"Orbitron,sans-serif",fontSize:11,color:vc||"#c8d6e5"}}>{v}</b></div>
                ))}
              </div>
              <div style={{fontSize:10,letterSpacing:1.5,color:"#4a5a6e"}}>LIVE · BASE MAINNET · VRF SECURED</div>

              {/* Code entry */}
              <div style={{width:"100%",border:"1px solid rgba(22,82,240,0.18)",borderRadius:10,background:"rgba(8,14,28,0.8)",overflow:"hidden"}}>
                {!codeSuccess ? (
                  <>
                    <div style={{padding:"14px 18px",borderBottom:"1px solid rgba(22,82,240,0.1)",background:"rgba(22,82,240,0.04)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontFamily:"Orbitron,sans-serif",fontSize:11,fontWeight:700,letterSpacing:2,color:"#e0e8f0"}}>GOT A CODE?</span>
                      <span style={{fontSize:10,color:"#4a5a6e"}}>Redeem for free rounds</span>
                    </div>
                    <div style={{padding:"14px 18px",display:"flex",flexDirection:"column",gap:9}}>
                      <div style={{position:"relative"}}>
                        <input type="text" value={code} placeholder="XXXX-XXXX" maxLength={9} autoComplete="off" spellCheck={false}
                          onChange={e=>formatCode(e.target.value)}
                          onFocus={()=>setShowCursor(false)}
                          onBlur={()=>{if(!code)setShowCursor(true);}}
                          onKeyDown={e=>e.key==="Enter"&&redeemCode()}
                          style={{width:"100%",background:"rgba(0,0,0,0.5)",border:`1px solid ${codeError?"rgba(255,51,85,0.5)":"rgba(22,82,240,0.2)"}`,borderRadius:7,padding:12,fontFamily:"Orbitron,sans-serif",fontSize:18,fontWeight:700,color:"#e0e8f0",textAlign:"center",letterSpacing:6,outline:"none",display:"block",caretColor:"#3B7BF6"}}/>
                        {showCursor && !code && (
                          <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",width:2,height:22,background:"#3B7BF6",animation:"caretBlink 1s step-end infinite",pointerEvents:"none"}}/>
                        )}
                      </div>
                      {codeError && <div style={{fontSize:10,color:"#ff3355",textAlign:"center",letterSpacing:0.5}}>{codeError}</div>}
                      <button onClick={redeemCode} disabled={codeLoading} style={{width:"100%",fontFamily:"Orbitron,sans-serif",fontSize:11,fontWeight:700,padding:11,borderRadius:7,border:"none",background:"linear-gradient(135deg,#1652F0,#3B7BF6)",color:"#fff",cursor:"pointer",letterSpacing:1.5,opacity:codeLoading?0.7:1}}>
                        {codeLoading?"VERIFYING...":"REDEEM CODE"}
                      </button>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{flex:1,height:1,background:"rgba(22,82,240,0.1)"}}/>
                        <span style={{fontSize:9,color:"#4a5a6e",letterSpacing:2}}>OR</span>
                        <div style={{flex:1,height:1,background:"rgba(22,82,240,0.1)"}}/>
                      </div>
                      <button onClick={()=>router.push("/play")} style={{width:"100%",fontFamily:"JetBrains Mono,monospace",fontSize:10,padding:9,borderRadius:6,border:"1px solid rgba(22,82,240,0.18)",background:"rgba(22,82,240,0.04)",color:"#5a6a7e",cursor:"pointer",letterSpacing:1}}>PLAY WITH USDC →</button>
                    </div>
                  </>
                ) : (
                  <div style={{padding:"24px 18px",display:"flex",flexDirection:"column",alignItems:"center",gap:12,textAlign:"center"}}>
                    <div style={{width:48,height:48,borderRadius:"50%",background:"rgba(0,204,136,0.1)",border:"2px solid rgba(0,204,136,0.4)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00cc88" strokeWidth="2.5" strokeLinecap="round"><path d="M5 13l4 4L19 7"/></svg>
                    </div>
                    <div style={{fontFamily:"Orbitron,sans-serif",fontSize:13,fontWeight:700,letterSpacing:2,color:"#e0e8f0"}}>CODE ACTIVATED</div>
                    <div style={{display:"flex",alignItems:"center",gap:12,background:"rgba(22,82,240,0.08)",border:"1px solid rgba(22,82,240,0.2)",borderRadius:8,padding:"12px 20px"}}>
                      <span style={{fontFamily:"Orbitron,sans-serif",fontSize:36,fontWeight:900,color:"#3B7BF6",lineHeight:1}}>2</span>
                      <span style={{fontSize:10,color:"#c8d6e5",letterSpacing:1,lineHeight:1.5}}>Free<br/>Rounds<br/>Credited</span>
                    </div>
                    <button onClick={()=>router.push("/play")} style={{width:"100%",fontFamily:"Orbitron,sans-serif",fontSize:11,fontWeight:700,padding:11,borderRadius:7,border:"none",background:"linear-gradient(135deg,#1652F0,#3B7BF6)",color:"#fff",cursor:"pointer",letterSpacing:1.5}}>ENTER THE GRID →</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div style={{height:1,background:"linear-gradient(90deg,transparent,rgba(22,82,240,0.2),transparent)"}}/>

      {/* How it works */}
      <section id="how-section" style={{position:"relative",zIndex:5}}>
        <div style={{maxWidth:1000,margin:"0 auto",padding:"70px 24px"}}>
          <div style={{textAlign:"center",marginBottom:48}}>
            <div style={{fontSize:10,letterSpacing:3,color:"#3B7BF6",fontWeight:700,marginBottom:10}}>HOW IT WORKS</div>
            <div style={{fontFamily:"Orbitron,sans-serif",fontSize:26,fontWeight:700,letterSpacing:1,color:"#e0e8f0"}}>Four Steps to Win</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
            {[
              {n:"01",icon:"🔐",t:"LOGIN",d:"Sign in with email, Google, or wallet. Privy creates an embedded wallet instantly — no seed phrase needed."},
              {n:"02",icon:"⬡",t:"PICK A CELL",d:"Choose any cell on the 5×5 grid. Costs 1 USDC. Multiple players can pick the same cell — they'll split if it wins."},
              {n:"03",icon:"🔬",t:"ZK PROOF",d:"When the 60s round ends, a Groth16 VRF proof runs. The winning cell is picked from occupied cells only — verified on-chain."},
              {n:"04",icon:"💰",t:"GET PAID",d:"Winners are paid automatically during resolution. No claim step. USDC goes straight to your wallet plus $ZERO rewards."},
            ].map(({n,icon,t,d})=>(
              <div key={n} style={{padding:24,border:"1px solid rgba(22,82,240,0.15)",borderRadius:8,background:"rgba(22,82,240,0.03)",display:"flex",flexDirection:"column",gap:12}}>
                <span style={{fontFamily:"Orbitron,sans-serif",fontSize:11,fontWeight:700,color:"#1652F0",background:"rgba(22,82,240,0.12)",borderRadius:4,padding:"3px 8px",display:"inline-block",letterSpacing:1}}>{n}</span>
                <div style={{fontSize:22}}>{icon}</div>
                <div style={{fontFamily:"Orbitron,sans-serif",fontSize:12,fontWeight:700,color:"#e0e8f0",letterSpacing:1}}>{t}</div>
                <div style={{fontSize:11,color:"#7a8b9e",lineHeight:1.7}}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div style={{height:1,background:"linear-gradient(90deg,transparent,rgba(22,82,240,0.2),transparent)"}}/>

      {/* Mechanics */}
      <section style={{position:"relative",zIndex:5}}>
        <div style={{maxWidth:1000,margin:"0 auto",padding:"70px 24px"}}>
          <div style={{textAlign:"center",marginBottom:48}}>
            <div style={{fontSize:10,letterSpacing:3,color:"#3B7BF6",fontWeight:700,marginBottom:10}}>GAME MECHANICS</div>
            <div style={{fontFamily:"Orbitron,sans-serif",fontSize:26,fontWeight:700,letterSpacing:1,color:"#e0e8f0"}}>Know the Rules</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <MechCard title="PAYOUT MATH">
              <p style={{fontSize:11,color:"#7a8b9e",lineHeight:1.75,margin:0}}>Every player adds 1 USDC to the pot. A 5% protocol fee and 0.1 USDC resolver reward are deducted, then the rest goes to winners on the winning cell.</p>
              <div style={{background:"rgba(0,0,0,0.3)",border:"1px solid rgba(22,82,240,0.1)",borderRadius:6,padding:"12px 14px",fontSize:11,color:"#4a5a6e",lineHeight:1.9}}>
                pool = <b style={{color:"#3B7BF6"}}>N</b> × 1 USDC<br/>
                fee = pool × <b style={{color:"#3B7BF6"}}>5%</b><br/>
                distributable = pool − fee − <b style={{color:"#3B7BF6"}}>0.1 USDC</b><br/>
                each winner = distributable ÷ <b style={{color:"#00cc88"}}>winners on cell</b>
              </div>
            </MechCard>
            <MechCard title="STRATEGY">
              <p style={{fontSize:11,color:"#7a8b9e",lineHeight:1.75,margin:0}}>Cells with many players give you better win odds but smaller per-winner payouts. Lonely cells pay out the entire pot if they win.</p>
              <div style={{background:"rgba(0,0,0,0.3)",border:"1px solid rgba(22,82,240,0.1)",borderRadius:6,padding:"12px 14px",fontSize:11,color:"#4a5a6e",lineHeight:1.9}}>
                <span style={{color:"#4a5a6e"}}>{`// 20 players, 3 on winning cell`}</span><br/>
                pool = <b style={{color:"#3B7BF6"}}>20 USDC</b><br/>
                distributable ≈ <b style={{color:"#3B7BF6"}}>18.9 USDC</b><br/>
                each winner = <b style={{color:"#00cc88"}}>+6.30 USDC</b>
              </div>
            </MechCard>
            <MechCard title="$ZERO REWARDS">
              <p style={{fontSize:11,color:"#7a8b9e",lineHeight:1.75,margin:0}}>Every resolved round mints <b style={{color:"#e0e8f0"}}>$ZERO tokens</b> to winners on top of USDC. TGE is deferred until meaningful user milestones — it&apos;s a gameplay reward, not a speculative asset.</p>
            </MechCard>
            <MechCard title="🔥 MOTHERLODE ROUNDS" gold>
              <p style={{fontSize:11,color:"#7a8b9e",lineHeight:1.75,margin:0}}>1 in 100 rounds is a Motherlode. Winners get <b style={{color:"#FFD700"}}>10× the normal USDC payout</b> plus 10× $ZERO emission. Determined by secondary VRF derivation.</p>
            </MechCard>
          </div>
        </div>
      </section>

      <div style={{height:1,background:"linear-gradient(90deg,transparent,rgba(22,82,240,0.2),transparent)"}}/>

      {/* $ZERO */}
      <section style={{position:"relative",zIndex:5}}>
        <div style={{maxWidth:1000,margin:"0 auto",padding:"70px 24px"}}>
          <div style={{textAlign:"center",marginBottom:48}}>
            <div style={{fontSize:10,letterSpacing:3,color:"#3B7BF6",fontWeight:700,marginBottom:10}}>TOKEN</div>
            <div style={{fontFamily:"Orbitron,sans-serif",fontSize:26,fontWeight:700,letterSpacing:1,color:"#e0e8f0"}}>$ZERO</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
            {[
              {l:"MAX SUPPLY",v:"5,000,000",s:"Minted to winners each round — 20.9K in circulation",bc:"rgba(22,82,240,0.15)",bg:"rgba(22,82,240,0.04)"},
              {l:"EMISSION / ROUND",v:"100",s:"$ZERO split among winning cell players",bc:"rgba(22,82,240,0.15)",bg:"rgba(22,82,240,0.04)",vc:"#3B7BF6"},
              {l:"MOTHERLODE",v:"1000",s:"10× emission on bonus rounds (1 in 100)",bc:"rgba(255,215,0,0.15)",bg:"rgba(255,215,0,0.03)",vc:"#FFD700"},
              {l:"TGE",v:"DEFERRED",s:"Unlocks only after meaningful user milestones",bc:"rgba(0,204,136,0.15)",bg:"rgba(0,204,136,0.03)",vc:"#00cc88",vs:16},
            ].map(({l,v,s,bc,bg,vc,vs})=>(
              <div key={l} style={{padding:20,border:`1px solid ${bc}`,borderRadius:8,background:bg,display:"flex",flexDirection:"column",gap:6}}>
                <div style={{fontSize:9,letterSpacing:2,color:"#4a5a6e",fontWeight:700}}>{l}</div>
                <div style={{fontFamily:"Orbitron,sans-serif",fontSize:vs||20,fontWeight:900,color:vc||"#e0e8f0",lineHeight:1.2}}>{v}</div>
                <div style={{fontSize:10,color:"#7a8b9e"}}>{s}</div>
              </div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <div style={{padding:24,border:"1px solid rgba(22,82,240,0.15)",borderRadius:8,background:"rgba(22,82,240,0.03)",display:"flex",flexDirection:"column",gap:14}}>
              <div style={{fontFamily:"Orbitron,sans-serif",fontSize:12,fontWeight:700,letterSpacing:1,color:"#e0e8f0"}}>HOW YOU EARN</div>
              {[
                {n:"01",text:<>Pick the winning cell — <b style={{color:"#e0e8f0"}}>100 $ZERO</b> split among all players on that cell</>},
                {n:"02",text:<>Pick alone on the winning cell — keep the entire <b style={{color:"#e0e8f0"}}>100 $ZERO</b> yourself</>},
                {n:"🔥",text:<>Win a Motherlode — earn <b style={{color:"#FFD700"}}>1000 $ZERO</b> on top of 10× USDC</>,gold:true},
              ].map(({n,text,gold})=>(
                <div key={n} style={{display:"flex",alignItems:"flex-start",gap:12,fontSize:11,color:"#7a8b9e",lineHeight:1.6}}>
                  <span style={{fontFamily:"Orbitron,sans-serif",fontSize:10,color:gold?"#FFD700":"#1652F0",background:gold?"rgba(255,215,0,0.08)":"rgba(22,82,240,0.12)",padding:"2px 7px",borderRadius:3,flexShrink:0,marginTop:1}}>{n}</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
            <div style={{padding:24,border:"1px solid rgba(22,82,240,0.15)",borderRadius:8,background:"rgba(22,82,240,0.03)",display:"flex",flexDirection:"column",gap:14}}>
              <div style={{fontFamily:"Orbitron,sans-serif",fontSize:12,fontWeight:700,letterSpacing:1,color:"#e0e8f0"}}>TGE TERMS</div>
              <div style={{fontSize:11,color:"#7a8b9e",lineHeight:1.8}}>There is no speculative launch. The TGE is <b style={{color:"#e0e8f0"}}>intentionally deferred</b> until GridZero reaches meaningful player milestones. $ZERO earned now accumulates in your wallet.</div>
              <div style={{background:"rgba(0,0,0,0.3)",border:"1px solid rgba(22,82,240,0.1)",borderRadius:6,padding:"12px 14px",fontSize:11,color:"#4a5a6e",lineHeight:1.8}}>
                <b style={{color:"#00cc88"}}>$ZERO is a gameplay reward</b> — not a speculative asset. Utility will be defined before TGE.
              </div>
            </div>
          </div>
        </div>
      </section>

      <div style={{height:1,background:"linear-gradient(90deg,transparent,rgba(22,82,240,0.2),transparent)"}}/>

      {/* ZK Proof */}
      <section style={{position:"relative",zIndex:5}}>
        <div style={{maxWidth:1000,margin:"0 auto",padding:"70px 24px"}}>
          <div style={{border:"1px solid rgba(22,82,240,0.15)",borderRadius:10,background:"rgba(22,82,240,0.03)",padding:40,display:"grid",gridTemplateColumns:"1fr 1fr",gap:48,alignItems:"center"}}>
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div style={{fontSize:10,letterSpacing:3,color:"#3B7BF6",fontWeight:700}}>PROVABLY FAIR</div>
              <div style={{fontFamily:"Orbitron,sans-serif",fontSize:20,fontWeight:700,color:"#e0e8f0",letterSpacing:1,lineHeight:1.3}}>Zero Knowledge<br/>Every Round</div>
              <div style={{fontSize:11,color:"#7a8b9e",lineHeight:1.8}}>Every winner selection is proven with a Groth16 ZK proof. Verified optimistically via Kurier in milliseconds and settled permanently on zkVerify.</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {["GROTH16","SNARKJS","BN128 CURVE"].map(p=><span key={p} style={{fontSize:9,padding:"3px 9px",borderRadius:3,fontWeight:700,letterSpacing:1,background:"rgba(22,82,240,0.12)",color:"#3B7BF6",border:"1px solid rgba(22,82,240,0.2)"}}>{p}</span>)}
                {["KURIER VERIFIED","ZKVERIFY SETTLED"].map(p=><span key={p} style={{fontSize:9,padding:"3px 9px",borderRadius:3,fontWeight:700,letterSpacing:1,background:"rgba(0,204,136,0.1)",color:"#00cc88",border:"1px solid rgba(0,204,136,0.2)"}}>{p}</span>)}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {ZK_STEPS.map((label,i)=>{
                const done=i<zkStep, active=i===zkStep;
                return (
                  <div key={i}>
                    <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:6,border:`1px solid ${active?"rgba(22,82,240,0.2)":done?"rgba(0,204,136,0.15)":"transparent"}`,background:active?"rgba(22,82,240,0.06)":done?"rgba(0,204,136,0.04)":"transparent",transition:"all 0.3s"}}>
                      <div style={{width:8,height:8,borderRadius:"50%",flexShrink:0,background:active?"#3B7BF6":done?"#00cc88":"rgba(22,82,240,0.2)",boxShadow:active?"0 0 6px #3B7BF6":"none",animation:active?"pulse 1.5s ease-in-out infinite":"none"}}/>
                      <span style={{fontSize:11,color:active?"#3B7BF6":done?"#00cc88":"#4a5a6e",fontWeight:active||done?600:400}}>{label}</span>
                    </div>
                    {i<ZK_STEPS.length-1&&<div style={{width:1,height:10,background:"rgba(22,82,240,0.15)",marginLeft:18}}/>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 24px",borderTop:"1px solid rgba(22,82,240,0.08)",background:"rgba(6,10,20,0.96)",zIndex:10,position:"relative"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <LogoIcon size={16}/>
          <span style={{fontSize:12,fontWeight:700,color:"#3B7BF6",letterSpacing:1.5,animation:"scanGlow 3s ease-in-out infinite"}}>GRID ONLINE</span>
        </div>
        <div style={{display:"flex",gap:20}}>
          {["CONTRACT","GITHUB","ZKVERIFY"].map(l=><a key={l} href="#" style={{fontSize:10,color:"#4a5a6e",textDecoration:"none",letterSpacing:1}}>{l}</a>)}
        </div>
        <div style={{fontSize:10,color:"#4a5a6e",letterSpacing:1}}>ON-CHAIN · BASE · VRF BY ZKVERIFY</div>
      </footer>

      <style>{`
        @keyframes cellAppear{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}
        @keyframes winnerGlow{0%,100%{box-shadow:0 0 10px rgba(255,200,0,0.35)}50%{box-shadow:0 0 28px rgba(255,200,0,0.75)}}
        @keyframes scanGlow{0%,100%{text-shadow:0 0 4px #3B7BF6}50%{text-shadow:0 0 12px #3B7BF6}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}
        @keyframes caretBlink{0%,100%{opacity:1}50%{opacity:0}}
        *{box-sizing:border-box}
        input::placeholder{color:#1e2e42}
      `}</style>
    </div>
  );
}
