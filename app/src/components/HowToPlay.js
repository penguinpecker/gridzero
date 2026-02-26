import { useState, useEffect, useRef } from "react";

const STEPS = [
  {
    num: "01",
    title: "CONNECT",
    subtitle: "Initialize your terminal",
    desc: "Hit LOGIN to create or connect your wallet. The Grid uses embedded wallets — no browser extension needed. Your wallet is created instantly via email, Google, or existing wallet.",
    icon: "⚡",
    color: "#ff8800",
  },
  {
    num: "02",
    title: "FUND",
    subtitle: "Fund your wallet",
    desc: "Deposit ETH to your The Grid wallet on MegaETH chain. Each grid claim costs 1 USDC. Use the sidebar to view your balance and claim winnings.",
    icon: "◆",
    color: "#00b4ff",
  },
  {
    num: "03",
    title: "CLAIM",
    subtitle: "Pick your cell",
    desc: "Select one cell on the 5×5 grid before the 30-second round timer expires. Multiple players can share the same cell — if that cell wins, the pot is split equally. Cells with fewer players mean a bigger payout if you win.",
    icon: "⛏",
    color: "#ff6633",
  },
  {
    num: "04",
    title: "RESOLVE",
    subtitle: "Guaranteed winner from occupied cells",
    desc: "When the timer hits zero, a Groth16 VRF proof verified by Kurier provides verifiable randomness to select the winning cell — but only from cells that have players. If you're in the round, someone is guaranteed to win. No more empty-cell outcomes.",
    icon: "🎲",
    color: "#c466ff",
  },
  {
    num: "05",
    title: "WIN",
    subtitle: "Collect your rewards",
    desc: "If you're on the winning cell, you split the pot equally with other players on that cell. USDC winnings are claimable from the contract. You also earn ZERO tokens. Hit the motherlode (1/100 chance) for a massive ZERO jackpot.",
    icon: "🎯",
    color: "#ffc800",
  },
];

const GRID_DEMO = [
  { label: "A1", state: "empty", count: 0 },
  { label: "A2", state: "claimed", count: 2 },
  { label: "A3", state: "empty", count: 0 },
  { label: "A4", state: "claimed", count: 1 },
  { label: "A5", state: "empty", count: 0 },
  { label: "B1", state: "empty", count: 0 },
  { label: "B2", state: "empty", count: 0 },
  { label: "B3", state: "yours", count: 3 },
  { label: "B4", state: "empty", count: 0 },
  { label: "B5", state: "claimed", count: 1 },
  { label: "C1", state: "claimed", count: 1 },
  { label: "C2", state: "empty", count: 0 },
  { label: "C3", state: "empty", count: 0 },
  { label: "C4", state: "empty", count: 0 },
  { label: "C5", state: "empty", count: 0 },
  { label: "D1", state: "empty", count: 0 },
  { label: "D2", state: "empty", count: 0 },
  { label: "D3", state: "claimed", count: 2 },
  { label: "D4", state: "empty", count: 0 },
  { label: "D5", state: "empty", count: 0 },
  { label: "E1", state: "empty", count: 0 },
  { label: "E2", state: "empty", count: 0 },
  { label: "E3", state: "empty", count: 0 },
  { label: "E4", state: "claimed", count: 1 },
  { label: "E5", state: "empty", count: 0 },
];

// Animated grid demo that cycles through game states
function AnimatedGrid() {
  const [phase, setPhase] = useState(0); // 0=picking, 1=countdown, 2=resolving, 3=winner
  const [timer, setTimer] = useState(12);
  const [winCell, setWinCell] = useState(7); // B3
  const [selectedCell, setSelectedCell] = useState(-1);
  const [scanX, setScanX] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPhase((p) => {
        if (p === 0) {
          setSelectedCell(7);
          return 1;
        }
        if (p === 1) {
          setTimer((t) => {
            if (t <= 1) return 0;
            return t - 1;
          });
          return 1;
        }
        return p;
      });
    }, 400);

    // Phase transitions
    const t1 = setTimeout(() => setPhase(1), 2000);
    const t2 = setTimeout(() => setPhase(2), 7000);
    const t3 = setTimeout(() => {
      setWinCell(7);
      setPhase(3);
    }, 9000);
    const t4 = setTimeout(() => {
      setPhase(0);
      setTimer(12);
      setSelectedCell(-1);
      setWinCell(-1);
    }, 13000);

    return () => {
      clearInterval(interval);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  // Reset cycle
  useEffect(() => {
    if (phase === 0) {
      const cycle = setTimeout(() => {
        setPhase(0);
        setTimer(12);
        setSelectedCell(-1);
        setWinCell(-1);
      }, 14000);
      return () => clearTimeout(cycle);
    }
  }, [phase]);

  // Scanning animation for resolve phase
  useEffect(() => {
    if (phase === 2) {
      const scan = setInterval(() => {
        setScanX((x) => (x + 1) % 25);
      }, 80);
      return () => clearInterval(scan);
    }
  }, [phase]);

  const getPhaseLabel = () => {
    if (phase === 0) return "SELECT YOUR CELL";
    if (phase === 1) return `ROUND ACTIVE — ${timer}S`;
    if (phase === 2) return "RESOLVING...";
    if (phase === 3) return "🎯 WINNER: B3!";
    return "";
  };

  return (
    <div style={{ width: "100%", maxWidth: 280 }}>
      <div
        style={{
          fontFamily: "'Orbitron', sans-serif",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 2,
          color:
            phase === 3
              ? "#ffc800"
              : phase === 2
              ? "#c466ff"
              : phase === 1
              ? "#ff8800"
              : "#5a7a6e",
          textAlign: "center",
          marginBottom: 8,
          minHeight: 16,
          transition: "color 0.3s",
        }}
      >
        {getPhaseLabel()}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 3,
        }}
      >
        {GRID_DEMO.map((cell, idx) => {
          const isWinner = phase === 3 && idx === winCell;
          const isYours = selectedCell === idx;
          const isClaimed = cell.state === "claimed" || cell.state === "yours";
          const isScanning = phase === 2 && idx === scanX;

          let bg = "rgba(255,136,0,0.03)";
          let border = "rgba(255,136,0,0.12)";
          let color = "#3a4a3e";
          let shadow = "none";

          if (isWinner) {
            bg = "rgba(255,200,0,0.2)";
            border = "rgba(255,200,0,0.6)";
            color = "#ffc800";
            shadow = "0 0 12px rgba(255,200,0,0.5)";
          } else if (isYours && phase >= 1) {
            bg = "rgba(255,136,0,0.12)";
            border = "rgba(255,136,0,0.5)";
            color = "#ff8800";
            shadow = "0 0 8px rgba(255,136,0,0.3)";
          } else if (isScanning) {
            bg = "rgba(196,102,255,0.15)";
            border = "rgba(196,102,255,0.4)";
            color = "#c466ff";
          } else if (isClaimed) {
            bg = "rgba(255,102,51,0.06)";
            border = "rgba(255,102,51,0.2)";
            color = "#ff6633";
          }

          return (
            <div
              key={idx}
              style={{
                aspectRatio: "1",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                border: `1px solid ${border}`,
                borderRadius: 4,
                background: bg,
                color,
                fontSize: 8,
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                transition: "all 0.15s ease",
                boxShadow: shadow,
                gap: 1,
              }}
            >
              <span style={{ letterSpacing: 1 }}>{cell.label}</span>
              {isWinner && <span style={{ fontSize: 12 }}>🎯</span>}
              {isYours && phase >= 1 && !isWinner && (
                <span style={{ fontSize: 10 }}>⛏</span>
              )}
              {isClaimed && !isYours && !isWinner && (
                <span style={{ fontSize: 8 }}>{cell.count > 1 ? `${cell.count}×` : "●"}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Animated flow diagram
function FlowDiagram() {
  const [activeNode, setActiveNode] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveNode((n) => (n + 1) % 5);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const nodes = [
    { label: "DEPOSIT", icon: "◆", x: 0 },
    { label: "CLAIM CELL", icon: "⛏", x: 1 },
    { label: "TIMER ENDS", icon: "⏱", x: 2 },
    { label: "drand VRF", icon: "🎲", x: 3 },
    { label: "WIN ETH+GRID", icon: "💰", x: 4 },
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        width: "100%",
        maxWidth: 600,
        margin: "0 auto",
        padding: "20px 0",
        overflowX: "auto",
      }}
    >
      {nodes.map((node, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              flex: 1,
              opacity: activeNode === i ? 1 : 0.4,
              transform: activeNode === i ? "scale(1.1)" : "scale(1)",
              transition: "all 0.5s ease",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: `2px solid ${activeNode === i ? "#ff8800" : "rgba(255,136,0,0.2)"}`,
                background:
                  activeNode === i
                    ? "rgba(255,136,0,0.15)"
                    : "rgba(255,136,0,0.03)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                boxShadow:
                  activeNode === i ? "0 0 20px rgba(255,136,0,0.3)" : "none",
                transition: "all 0.5s ease",
              }}
            >
              {node.icon}
            </div>
            <span
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: 1.5,
                fontFamily: "'Orbitron', sans-serif",
                color: activeNode === i ? "#ff8800" : "#4a5a6e",
                transition: "color 0.5s ease",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              {node.label}
            </span>
          </div>
          {i < nodes.length - 1 && (
            <div
              style={{
                width: 30,
                height: 2,
                background:
                  activeNode > i
                    ? "rgba(255,136,0,0.5)"
                    : "rgba(255,136,0,0.1)",
                flexShrink: 0,
                transition: "background 0.5s ease",
                position: "relative",
              }}
            >
              {activeNode === i && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: -2,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#ff8800",
                    boxShadow: "0 0 8px #ff8800",
                    animation: "flowPulse 1s ease-in-out infinite",
                  }}
                />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Payout breakdown visualization
function PayoutBreakdown() {
  const [hovered, setHovered] = useState(-1);
  const segments = [
    { label: "WINNERS", pct: 90, color: "#ff8800", desc: "Split equally among all players on the winning cell" },
    { label: "PROTOCOL FEE", pct: 10, color: "#ff6633", desc: "Supports development, buybacks, and NFT staker rewards" },
  ];

  return (
    <div style={{ width: "100%", maxWidth: 400 }}>
      <div
        style={{
          display: "flex",
          height: 24,
          borderRadius: 6,
          overflow: "hidden",
          border: "1px solid rgba(255,136,0,0.2)",
        }}
      >
        {segments.map((seg, i) => (
          <div
            key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(-1)}
            style={{
              width: `${seg.pct}%`,
              background:
                hovered === i
                  ? seg.color
                  : `${seg.color}44`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontWeight: 700,
              fontFamily: "'Orbitron', sans-serif",
              letterSpacing: 1,
              color: hovered === i ? "#000" : seg.color,
              transition: "all 0.3s ease",
              cursor: "default",
            }}
          >
            {seg.pct}%
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ flex: seg.pct / 100, paddingRight: i === 0 ? 10 : 0 }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: seg.color,
                letterSpacing: 1,
                fontFamily: "'Orbitron', sans-serif",
              }}
            >
              {seg.label}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#6a7b8e",
                marginTop: 2,
                lineHeight: 1.4,
              }}
            >
              {seg.desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// FAQ Accordion
function FAQ() {
  const [open, setOpen] = useState(-1);
  const items = [
    {
      q: "What chain is The Grid on?",
      a: "MegaETH — a high-performance L2 with 10ms block times. This enables 30-second game rounds with near-instant settlement.",
    },
    {
      q: "Is the randomness fair?",
      a: "Yes. The Grid uses drand (League of Entropy) beacon randomness, which is publicly verifiable and cannot be manipulated by anyone — including the developers.",
    },
    {
      q: "How does the guaranteed winner work?",
      a: "The winning cell is chosen only from cells that have at least one player. If you're in the round, someone is guaranteed to win — no more empty-cell outcomes eating the pot.",
    },
    {
      q: "Can multiple players pick the same cell?",
      a: "Yes. Multiple players can share a cell. If that cell wins, the pot is split equally among all players on it. Cells with fewer players mean a bigger individual payout.",
    },
    {
      q: "What is the GRID token?",
      a: "GRID is an ERC-20 token with a hard cap of 1,000,000. It's minted to round winners. NFT stakers receive a 50% bonus on GRID rewards.",
    },
    {
      q: "What is the Motherlode?",
      a: "Each round with players has a 1/100 chance (0.16%) of triggering the Motherlode — a massive ZERO jackpot that accumulates every round until it hits.",
    },
    {
      q: "Do I need MetaMask?",
      a: "No. The Grid uses Privy embedded wallets. Login with email, Google, or any wallet. Your keys are created and stored securely without any extension.",
    },
    {
      q: "How do I withdraw my winnings?",
      a: "ETH winnings are sent directly to your wallet when your cell wins. You can also withdraw ETH to any address via the menu. If a transfer ever fails, your ETH is safely escrowed and can be claimed via the Withdraw button.",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%", maxWidth: 600 }}>
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            border: "1px solid rgba(255,136,0,0.1)",
            borderRadius: 6,
            overflow: "hidden",
            background: open === i ? "rgba(255,136,0,0.04)" : "rgba(255,136,0,0.01)",
            transition: "background 0.3s ease",
          }}
        >
          <button
            onClick={() => setOpen(open === i ? -1 : i)}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "none",
              border: "none",
              color: open === i ? "#ff8800" : "#8a9bae",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              cursor: "pointer",
              textAlign: "left",
              letterSpacing: 0.5,
              transition: "color 0.2s",
            }}
          >
            <span>{item.q}</span>
            <span
              style={{
                transform: open === i ? "rotate(45deg)" : "rotate(0deg)",
                transition: "transform 0.3s ease",
                fontSize: 16,
                flexShrink: 0,
                marginLeft: 8,
              }}
            >
              +
            </span>
          </button>
          <div
            style={{
              maxHeight: open === i ? 200 : 0,
              overflow: "hidden",
              transition: "max-height 0.4s ease",
            }}
          >
            <div
              style={{
                padding: "0 16px 14px",
                fontSize: 11,
                color: "#6a7b8e",
                lineHeight: 1.6,
              }}
            >
              {item.a}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Main Page
export default function HowToPlay() {
  const [visible, setVisible] = useState(false);
  const [scanLine, setScanLine] = useState(0);
  const [activeStep, setActiveStep] = useState(-1);
  const stepRefs = useRef([]);

  useEffect(() => {
    setVisible(true);
    const scanInterval = setInterval(() => {
      setScanLine((s) => (s >= 100 ? 0 : s + 0.3));
    }, 30);
    return () => clearInterval(scanInterval);
  }, []);

  // Intersection observer for step animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.dataset.step);
            setActiveStep((prev) => Math.max(prev, idx));
          }
        });
      },
      { threshold: 0.3 }
    );
    stepRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        background:
          "radial-gradient(ellipse at 30% 20%, #0f1923 0%, #0a0c0f 50%, #080a0d 100%)",
        color: "#c8d6e5",
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* CRT scanline */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: "none",
          zIndex: 2,
          background: `linear-gradient(180deg,
            transparent ${scanLine - 2}%,
            rgba(255,136,0,0.08) ${scanLine - 1}%,
            rgba(255,136,0,0.2) ${scanLine}%,
            rgba(255,136,0,0.08) ${scanLine + 1}%,
            transparent ${scanLine + 2}%)`,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: "none",
          zIndex: 1,
          background:
            "repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)",
        }}
      />

      {/* ─── HEADER ─── */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 20px",
          borderBottom: "1px solid rgba(255,136,0,0.12)",
          background: "rgba(10,12,15,0.95)",
          zIndex: 10,
          position: "sticky",
          top: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#ff6633",
              boxShadow: "0 0 8px #ff663388",
              display: "inline-block",
            }}
          />
          <span
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 900,
              fontSize: 18,
              color: "#ff6633",
              letterSpacing: 2,
            }}
          >
            THE
          </span>
          <span
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 500,
              fontSize: 18,
              color: "#e0e8f0",
              letterSpacing: 2,
            }}
          >
            GRID
          </span>
          <span
            style={{
              fontSize: 9,
              padding: "2px 6px",
              borderRadius: 3,
              background: "rgba(255,136,0,0.12)",
              color: "#ff8800",
              letterSpacing: 1.5,
              fontWeight: 600,
            }}
          >
            HOW TO PLAY
          </span>
        </div>
        <a
          href="/"
          style={{
            fontFamily: "'Orbitron', sans-serif",
            fontSize: 11,
            fontWeight: 700,
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid #ff8800",
            background:
              "linear-gradient(135deg, rgba(255,136,0,0.15), rgba(255,136,0,0.05))",
            color: "#ff8800",
            cursor: "pointer",
            letterSpacing: 1.5,
            textDecoration: "none",
          }}
        >
          ⛏ PLAY NOW
        </a>
      </header>

      {/* ─── CONTENT ─── */}
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "40px 20px 80px",
          position: "relative",
          zIndex: 5,
        }}
      >
        {/* Hero */}
        <div
          style={{
            textAlign: "center",
            marginBottom: 50,
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(20px)",
            transition: "all 0.8s ease",
          }}
        >
          <div
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 11,
              letterSpacing: 4,
              color: "#5a6a7e",
              marginBottom: 12,
            }}
          >
            MINING PROTOCOL v2.0
          </div>
          <h1
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 36,
              fontWeight: 900,
              color: "#ff8800",
              margin: 0,
              letterSpacing: 3,
              textShadow: "0 0 40px rgba(255,136,0,0.25)",
              lineHeight: 1.2,
            }}
          >
            HOW TO PLAY
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "#6a7b8e",
              marginTop: 12,
              lineHeight: 1.6,
              maxWidth: 500,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            5×5 grid. 30 seconds. Pick a cell. If randomness lands on yours
            — you win ETH and GRID tokens.
          </p>
        </div>

        {/* Flow Diagram */}
        <div
          style={{
            marginBottom: 50,
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(20px)",
            transition: "all 0.8s ease 0.2s",
          }}
        >
          <FlowDiagram />
        </div>

        {/* ─── STEPS ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {STEPS.map((step, i) => (
            <div
              key={i}
              ref={(el) => (stepRefs.current[i] = el)}
              data-step={i}
              style={{
                display: "flex",
                gap: 20,
                padding: 24,
                borderRadius: 10,
                border: `1px solid ${activeStep >= i ? `${step.color}33` : "rgba(255,136,0,0.06)"}`,
                background:
                  activeStep >= i
                    ? `linear-gradient(135deg, ${step.color}08, transparent)`
                    : "rgba(255,136,0,0.01)",
                opacity: activeStep >= i ? 1 : 0.3,
                transform: activeStep >= i ? "translateX(0)" : "translateX(-20px)",
                transition: "all 0.6s ease",
                alignItems: "flex-start",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Step Number */}
              <div
                style={{
                  fontFamily: "'Orbitron', sans-serif",
                  fontSize: 32,
                  fontWeight: 900,
                  color: `${step.color}22`,
                  lineHeight: 1,
                  flexShrink: 0,
                  minWidth: 50,
                }}
              >
                {step.num}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 18 }}>{step.icon}</span>
                  <span
                    style={{
                      fontFamily: "'Orbitron', sans-serif",
                      fontSize: 16,
                      fontWeight: 700,
                      color: step.color,
                      letterSpacing: 2,
                    }}
                  >
                    {step.title}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#5a6a7e",
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    marginBottom: 8,
                    fontWeight: 600,
                  }}
                >
                  {step.subtitle}
                </div>
                <p
                  style={{
                    fontSize: 12,
                    color: "#8a9bae",
                    lineHeight: 1.7,
                    margin: 0,
                  }}
                >
                  {step.desc}
                </p>
              </div>

              {/* Interactive demo for step 3 (CLAIM) */}
              {i === 2 && (
                <div style={{ flexShrink: 0 }}>
                  <AnimatedGrid />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ─── PAYOUT SECTION ─── */}
        <div
          style={{
            marginTop: 50,
            padding: 24,
            borderRadius: 10,
            border: "1px solid rgba(255,136,0,0.12)",
            background: "rgba(255,136,0,0.02)",
          }}
        >
          <div
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 2,
              color: "#8a9bae",
              marginBottom: 6,
            }}
          >
            💰 PAYOUT STRUCTURE
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#5a6a7e",
              marginBottom: 16,
              lineHeight: 1.5,
            }}
          >
            Each round's total pot is split as follows:
          </div>
          <PayoutBreakdown />

          {/* Motherlode callout */}
          <div
            style={{
              marginTop: 20,
              padding: 14,
              borderRadius: 8,
              border: "1px solid rgba(255,200,0,0.2)",
              background:
                "linear-gradient(135deg, rgba(255,200,0,0.06), rgba(255,136,0,0.02))",
              display: "flex",
              gap: 12,
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 28 }}>🌋</span>
            <div>
              <div
                style={{
                  fontFamily: "'Orbitron', sans-serif",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#ffc800",
                  letterSpacing: 1.5,
                }}
              >
                MOTHERLODE JACKPOT
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#8a9bae",
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                Every round adds a portion to the bonus pool. Winners have a
                1/100 chance of triggering it — triggering a 10× USDC + 10 ZERO
                jackpot.
              </div>
            </div>
          </div>
        </div>

        {/* ─── KEY STATS ─── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8,
            marginTop: 30,
          }}
        >
          {[
            { label: "ROUND TIME", value: "30s", icon: "⏱" },
            { label: "GRID SIZE", value: "5×5", icon: "▦" },
            { label: "ENTRY COST", value: "1 USDC", icon: "◆" },
            { label: "ZERO SUPPLY", value: "1,000,000", icon: "🪨" },
          ].map((stat, i) => (
            <div
              key={i}
              style={{
                padding: "16px 14px",
                borderRadius: 8,
                border: "1px solid rgba(255,136,0,0.1)",
                background: "rgba(255,136,0,0.02)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 18, marginBottom: 6 }}>{stat.icon}</div>
              <div
                style={{
                  fontFamily: "'Orbitron', sans-serif",
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#ff8800",
                }}
              >
                {stat.value}
              </div>
              <div
                style={{
                  fontSize: 8,
                  letterSpacing: 1.5,
                  color: "#5a6a7e",
                  fontWeight: 600,
                  marginTop: 4,
                }}
              >
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* ─── FAQ ─── */}
        <div style={{ marginTop: 50 }}>
          <div
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 2,
              color: "#8a9bae",
              marginBottom: 16,
            }}
          >
            ❓ FREQUENTLY ASKED
          </div>
          <FAQ />
        </div>

        {/* ─── CTA ─── */}
        <div
          style={{
            textAlign: "center",
            marginTop: 60,
            padding: "30px 20px",
            borderRadius: 12,
            border: "1px solid rgba(255,136,0,0.2)",
            background:
              "linear-gradient(135deg, rgba(255,136,0,0.08), rgba(255,102,51,0.04))",
          }}
        >
          <div
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 20,
              fontWeight: 900,
              color: "#ff8800",
              letterSpacing: 3,
              marginBottom: 10,
            }}
          >
            READY TO PLAY?
          </div>
          <div style={{ fontSize: 12, color: "#6a7b8e", marginBottom: 20 }}>
            Join the grid. Pick your cell. May the randomness be in your favor.
          </div>
          <a
            href="/"
            style={{
              display: "inline-block",
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 14,
              fontWeight: 700,
              padding: "14px 32px",
              borderRadius: 8,
              border: "1px solid #ff8800",
              background:
                "linear-gradient(135deg, rgba(255,136,0,0.2), rgba(255,136,0,0.05))",
              color: "#ff8800",
              cursor: "pointer",
              letterSpacing: 2,
              textDecoration: "none",
              boxShadow: "0 0 30px rgba(255,136,0,0.15)",
            }}
          >
            ⛏ ENTER THE GRID
          </a>
        </div>
      </div>

      {/* ─── FOOTER ─── */}
      <footer
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 20px",
          borderTop: "1px solid rgba(255,136,0,0.08)",
          background: "rgba(10,12,15,0.95)",
          zIndex: 10,
          position: "relative",
        }}
      >
        <span style={{ fontSize: 10, color: "#3a4a5e" }}>
          GridZero V2 — Base Mainnet
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#ff8800",
            letterSpacing: 1.5,
            fontFamily: "'Orbitron', sans-serif",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#ff8800",
              boxShadow: "0 0 6px #ff880088",
              marginRight: 6,
            }}
          />
          GRID ONLINE
        </span>
      </footer>

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,136,0,0.2); border-radius: 3px; }
        @keyframes flowPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.5); }
        }
      `}</style>
    </div>
  );
}
