import { useState, useEffect } from "react";
import { ethers } from "ethers";

const CONTRACT_ADDRESS = "0x3b1958ee8e636d69E868CaFCad3e7dB2eE8B4755";
const BACKEND_URL = "https://silentflow-production.up.railway.app";

const ABI = [
  "function depositETH(address recipient) external payable",
  "function depositToken(address token, uint256 amount, address recipient) external",
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];
const TOKENS = {
  ETH:  { address: null, decimals: 18 },
  USDC: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 },
  USDT: { address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0", decimals: 6 },
};

const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Mono:wght@300;400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:#04060e;color:#d8dce8;font-family:'DM Mono',monospace;min-height:100vh}

/* BG */
.bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.bg-glow{position:absolute;width:1000px;height:600px;top:-280px;left:50%;transform:translateX(-50%);background:radial-gradient(ellipse,rgba(30,144,255,.06) 0%,transparent 65%);border-radius:50%}
.bg-line{position:absolute;top:0;left:50%;transform:translateX(-50%);width:55%;height:1px;background:linear-gradient(90deg,transparent,rgba(30,144,255,.28),transparent)}

.wrap{position:relative;z-index:1;max-width:1020px;margin:0 auto;padding:0 28px 80px}

/* ── HEADER ── */
.hdr{
  display:flex;align-items:center;justify-content:space-between;
  padding:26px 0 26px;
  border-bottom:1px solid rgba(255,255,255,.05);
  margin-bottom:52px;
}
.logo-group{display:flex;align-items:center;gap:16px}
.logo-main{height:54px;width:auto;object-fit:contain;filter:drop-shadow(0 0 16px rgba(30,144,255,.3))}
.logo-divider{display:none}
.logo-secondary{display:none}

.hdr-right{display:flex;align-items:center;gap:12px}
.net-dot{position:relative;display:flex;align-items:center;gap:7px;padding:7px 13px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;font-size:11px;color:rgba(255,255,255,.35);letter-spacing:.5px}
.net-dot::before{content:'';width:7px;height:7px;border-radius:50%;background:#00dc64;box-shadow:0 0 6px #00dc64;animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

.conn-btn{padding:9px 20px;background:transparent;border:1px solid rgba(255,255,255,.11);border-radius:9px;color:rgba(255,255,255,.45);font-family:'DM Mono',monospace;font-size:13px;cursor:pointer;transition:all .2s;letter-spacing:.2px}
.conn-btn:hover{border-color:rgba(255,255,255,.22);color:rgba(255,255,255,.75)}
.conn-btn.on{border-color:rgba(0,220,100,.22);color:#00dc64;background:rgba(0,220,100,.05)}

/* ── GRID ── */
.grid{display:grid;grid-template-columns:1fr 368px;gap:28px;align-items:start}

/* ── LEFT ── */
.left{display:flex;flex-direction:column;gap:20px}

/* History */
.card{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:16px;overflow:hidden}
.card-head{padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.04);display:flex;align-items:center;justify-content:space-between}
.card-title{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:rgba(255,255,255,.3);letter-spacing:2px;text-transform:uppercase}
.card-count{font-size:11px;color:rgba(255,255,255,.2);background:rgba(255,255,255,.04);padding:2px 8px;border-radius:20px}
.card-body{padding:6px 0}

.hist-empty{text-align:center;padding:32px 0;color:rgba(255,255,255,.15);font-size:13px}
.hist-item{padding:14px 22px;border-bottom:1px solid rgba(255,255,255,.03);transition:background .15s}
.hist-item:hover{background:rgba(255,255,255,.015)}
.hist-item:last-child{border-bottom:none}
.hist-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.hist-amt{font-size:15px;font-weight:500;color:#d8dce8}
.hist-time{font-size:11px;color:rgba(255,255,255,.18)}
.hist-to{font-size:12px;color:rgba(255,255,255,.3);margin-bottom:8px}
.hist-foot{display:flex;align-items:center;justify-content:space-between}
.hist-pill{font-size:11px;padding:2px 10px;border-radius:20px}
.hist-pill.done{background:rgba(0,220,100,.06);border:1px solid rgba(0,220,100,.15);color:#00dc64}
.hist-pill.proc{background:rgba(30,144,255,.06);border:1px solid rgba(30,144,255,.15);color:#4da6ff}
.hist-link{font-size:11px;color:rgba(255,255,255,.2);text-decoration:none;transition:color .2s}
.hist-link:hover{color:rgba(255,255,255,.5)}

/* Privacy accordion */
.accord{background:rgba(255,255,255,.015);border:1px solid rgba(255,255,255,.05);border-radius:14px;overflow:hidden}
.accord-toggle{display:flex;align-items:center;justify-content:space-between;padding:15px 20px;cursor:pointer;user-select:none;transition:background .15s}
.accord-toggle:hover{background:rgba(255,255,255,.025)}
.accord-label{font-size:12px;color:rgba(255,255,255,.28);letter-spacing:.3px}
.accord-arrow{font-size:10px;color:rgba(255,255,255,.18);transition:transform .25s}
.accord-arrow.open{transform:rotate(180deg)}
.accord-body{max-height:0;overflow:hidden;transition:max-height .3s ease,opacity .3s ease;opacity:0}
.accord-body.open{max-height:260px;opacity:1}
.accord-row{display:flex;justify-content:space-between;padding:11px 20px;border-top:1px solid rgba(255,255,255,.03)}
.accord-k{font-size:12px;color:rgba(255,255,255,.28)}
.accord-v{font-size:12px;color:rgba(255,255,255,.45)}

/* ── FORM CARD ── */
.form-card{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:28px;position:sticky;top:24px}

.form-title{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#fff;margin-bottom:2px;letter-spacing:-.4px}
.form-tagline{font-size:11px;color:rgba(255,255,255,.22);margin-bottom:26px;letter-spacing:.2px}

.toks{display:flex;gap:6px;margin-bottom:20px}
.tok{flex:1;padding:9px 0;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;color:rgba(255,255,255,.35);font-family:'DM Mono',monospace;font-size:13px;cursor:pointer;transition:all .2s}
.tok:hover{border-color:rgba(255,255,255,.15);color:rgba(255,255,255,.6)}
.tok.on{background:rgba(30,144,255,.1);border-color:rgba(30,144,255,.32);color:#4da6ff}

.fld{margin-bottom:14px}
.fld label{display:block;font-size:10px;color:rgba(255,255,255,.26);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:7px}
.fld input{width:100%;padding:13px 14px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:10px;color:#fff;font-family:'DM Mono',monospace;font-size:14px;outline:none;transition:all .2s}
.fld input:focus{border-color:rgba(30,144,255,.32);background:rgba(30,144,255,.04)}
.fld input::placeholder{color:rgba(255,255,255,.14)}

.sep{height:1px;background:rgba(255,255,255,.05);margin:18px 0}

.fee-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.fee-l{font-size:12px;color:rgba(255,255,255,.22)}
.fee-v{font-size:12px;color:rgba(255,255,255,.38)}

.send-btn{width:100%;padding:15px;background:linear-gradient(135deg,#1a7fe8 0%,#0050b3 100%);border:none;border-radius:11px;color:#fff;font-family:'Syne',sans-serif;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s;letter-spacing:.2px;box-shadow:0 2px 18px rgba(30,144,255,.16)}
.send-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 5px 28px rgba(30,144,255,.28)}
.send-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}

.status-box{margin-top:14px;padding:12px 14px;border-radius:10px;background:rgba(30,144,255,.05);border:1px solid rgba(30,144,255,.13)}
.status-box pre{font-family:'DM Mono',monospace;font-size:12px;color:#4da6ff;white-space:pre-wrap;margin:0;line-height:1.6}
.status-box.ok{background:rgba(0,220,100,.05);border-color:rgba(0,220,100,.13)}
.status-box.ok pre{color:#00dc64}
.status-box.err{background:rgba(255,90,90,.05);border-color:rgba(255,90,90,.13)}
.status-box.err pre{color:#ff7070}

/* ── FOOTER ── */
.footer{margin-top:60px;padding-top:24px;border-top:1px solid rgba(255,255,255,.04);display:flex;justify-content:space-between;align-items:center}
.footer-left{font-size:11px;color:rgba(255,255,255,.18)}
.footer-right{display:flex;gap:20px}
.footer-link{font-size:11px;color:rgba(255,255,255,.2);text-decoration:none;transition:color .2s}
.footer-link:hover{color:rgba(255,255,255,.5)}

@media(max-width:760px){
  .grid{grid-template-columns:1fr}
  .form-card{position:static}
  .hdr{padding:18px 0 22px;margin-bottom:32px}
  .logo-secondary{display:none}
  .logo-divider{display:none}
}
`;

export default function App() {
  const [account, setAccount]       = useState(null);
  const [amount, setAmount]         = useState("");
  const [recipient, setRecipient]   = useState("");
  const [token, setToken]           = useState("ETH");
  const [status, setStatus]         = useState("");
  const [statusType, setStatusType] = useState("");
  const [loading, setLoading]       = useState(false);
  const [history, setHistory]       = useState([]);
  const [pendingId, setPendingId]   = useState(null);
  const [accordOpen, setAccordOpen] = useState(false);

  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = STYLE;
    document.head.appendChild(s);
    return () => document.head.removeChild(s);
  }, []);

  useEffect(() => {
    if (!pendingId) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/status/${pendingId}`);
        const d = await r.json();
        if (d.concluido) {
          setStatus("Transação entregue com sucesso.");
          setStatusType("ok");
          clearInterval(iv);
          setPendingId(null);
          setHistory(h => h.map(t => t.id === pendingId ? { ...t, done: true } : t));
        } else {
          setStatus(`Processando... ${d.hopsFeitos}/${d.hopsTotal} etapas · ~${d.minutosRestantes} min`);
          setStatusType("");
        }
      } catch (_) {}
    }, 15000);
    return () => clearInterval(iv);
  }, [pendingId]);

  const connect = async () => {
    if (!window.ethereum) return alert("MetaMask não encontrada.");
    const p = new ethers.BrowserProvider(window.ethereum);
    const [acc] = await p.send("eth_requestAccounts", []);
    setAccount(acc);
  };

  const send = async () => {
    if (!account)              return alert("Conecte sua carteira.");
    if (!amount || !recipient) return alert("Preencha todos os campos.");
    setLoading(true);
    setStatus("Iniciando envio seguro...");
    setStatusType("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      let txHash;

      if (token === "ETH") {
        const tx = await contract.depositETH(recipient, { value: ethers.parseEther(amount) });
        await tx.wait(); txHash = tx.hash;
      } else {
        const t   = TOKENS[token];
        const tc  = new ethers.Contract(t.address, ERC20_ABI, signer);
        const val = ethers.parseUnits(amount, t.decimals);
        const allow = await tc.allowance(account, CONTRACT_ADDRESS);
        if (allow < val) { const a = await tc.approve(CONTRACT_ADDRESS, val); await a.wait(); }
        const tx = await contract.depositToken(t.address, val, recipient);
        await tx.wait(); txHash = tx.hash;
      }

      const res  = await fetch(`${BACKEND_URL}/agendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash, destinatario: recipient, valor: amount, token }),
      });
      const data = await res.json();
      setPendingId(data.id);

      setHistory(h => [{
        id: data.id, hash: txHash, amount, token,
        recipient: recipient.slice(0,6) + "..." + recipient.slice(-4),
        time: new Date().toLocaleTimeString("pt-BR"),
        done: false,
      }, ...h]);

      setStatus(`Enviando ${amount} ${token}.\nEstimativa: ~${data.estimativaMinutos} minutos.`);
      setAmount(""); setRecipient("");
    } catch (e) {
      setStatus(e.reason || e.message || "Erro desconhecido.");
      setStatusType("err");
    }
    setLoading(false);
  };

  const fee = amount && !isNaN(parseFloat(amount))
    ? `${(parseFloat(amount) * 0.002).toFixed(6)} ${token}`
    : "—";

  return (
    <>
      <div className="bg">
        <div className="bg-glow" />
        <div className="bg-line" />
      </div>
      <div className="wrap">

        {/* HEADER */}
        <header className="hdr">
          <div className="logo-group">
            <img className="logo-main" src="/logo.png" alt="SilentFlow" />
            <div className="logo-divider" />
            <img className="logo-secondary" src="/logo2.png" alt="" />
          </div>
          <div className="hdr-right">
            <div className="net-dot">SEPOLIA</div>
            <button className={`conn-btn${account ? " on" : ""}`} onClick={connect}>
              {account ? `● ${account.slice(0,6)}...${account.slice(-4)}` : "Conectar Carteira"}
            </button>
          </div>
        </header>

        {/* GRID */}
        <div className="grid">

          {/* LEFT */}
          <div className="left">

            {/* History */}
            <div className="card">
              <div className="card-head">
                <span className="card-title">Histórico</span>
                {history.length > 0 && <span className="card-count">{history.length}</span>}
              </div>
              <div className="card-body">
                {history.length === 0
                  ? <div className="hist-empty">Nenhuma transação ainda</div>
                  : history.map(tx => (
                    <div className="hist-item" key={tx.id}>
                      <div className="hist-row">
                        <span className="hist-amt">{tx.amount} {tx.token}</span>
                        <span className="hist-time">{tx.time}</span>
                      </div>
                      <div className="hist-to">→ {tx.recipient}</div>
                      <div className="hist-foot">
                        <span className={`hist-pill ${tx.done ? "done" : "proc"}`}>
                          {tx.done ? "Entregue" : "Processando"}
                        </span>
                        <a className="hist-link" href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noreferrer">
                          Etherscan ↗
                        </a>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>

            {/* Privacy accordion */}
            <div className="accord">
              <div className="accord-toggle" onClick={() => setAccordOpen(o => !o)}>
                <span className="accord-label">Como funciona a privacidade</span>
                <span className={`accord-arrow${accordOpen ? " open" : ""}`}>▼</span>
              </div>
              <div className={`accord-body${accordOpen ? " open" : ""}`}>
                {[
                  ["Split automático",   "2–4 partes aleatórias"],
                  ["Multi-hop",          "2–3 endereços efêmeros por parte"],
                  ["Delay",              "1–10 minutos por hop"],
                  ["Dummy transactions", "ruído entre hops reais"],
                  ["Taxa",               "0.2% por transação"],
                ].map(([k, v]) => (
                  <div className="accord-row" key={k}>
                    <span className="accord-k">{k}</span>
                    <span className="accord-v">{v}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* FORM */}
          <div className="form-card">
            <div className="form-title">Envio Privado</div>
            <div className="form-tagline">Non-custodial · sem rastreabilidade · 0.2% de taxa</div>

            <div className="toks">
              {Object.keys(TOKENS).map(t => (
                <button key={t} className={`tok${token===t?" on":""}`} onClick={() => setToken(t)}>{t}</button>
              ))}
            </div>

            <div className="fld">
              <label>Valor</label>
              <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>

            <div className="fld">
              <label>Destinatário</label>
              <input type="text" placeholder="0x..." value={recipient} onChange={e => setRecipient(e.target.value)} />
            </div>

            <div className="sep" />

            <div className="fee-row">
              <span className="fee-l">Taxa de privacidade</span>
              <span className="fee-v">{fee}</span>
            </div>

            <button className="send-btn" onClick={send} disabled={loading || !account}>
              {loading ? "Processando..." : "Enviar"}
            </button>

            {status && (
              <div className={`status-box${statusType ? " "+statusType : ""}`}>
                <pre>{status}</pre>
              </div>
            )}
          </div>

        </div>

        {/* FOOTER */}
        <footer className="footer">
          <div style={{display:"flex",alignItems:"center",gap:"12px"}}><img src="/logo2.png" alt="SilentFlow" style={{height:"24px",width:"auto",opacity:.55}} /><span className="footer-left">v2 · Privacy Layer for Web3</span></div>
          <div className="footer-right">
            <a className="footer-link" href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Contrato ↗</a>
            <a className="footer-link" href="https://silentflow-landing-wine.vercel.app" target="_blank" rel="noreferrer">Landing page ↗</a>
          </div>
        </footer>

      </div>
    </>
  );
}
