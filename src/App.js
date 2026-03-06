import { useState, useEffect } from "react";
import { ethers } from "ethers";

const CONTRACT_ADDRESS = "0x3b1958ee8e636d69E868CaFCad3e7dB2eE8B4755";
const BACKEND_URL = "https://silentflow-production.up.railway.app";
const LOGO_URL = "https://raw.githubusercontent.com/marellobr/silentflow/main/frontend/public/logo-silentflow-principal.png";

const ABI = [
  "function depositETH(address recipient) external payable",
  "function depositToken(address token, uint256 amount, address recipient) external",
  "event Deposit(address indexed sender, address indexed recipient, address token, uint256 amount)",
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
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#03060f;color:#e8eaf0;font-family:'DM Mono',monospace;min-height:100vh}

.bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.bg::before{content:'';position:absolute;width:800px;height:800px;top:-300px;left:50%;transform:translateX(-50%);background:radial-gradient(ellipse,rgba(30,144,255,.07) 0%,transparent 70%);border-radius:50%}
.bg::after{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:60%;height:1px;background:linear-gradient(90deg,transparent,rgba(30,144,255,.35),transparent)}

.wrap{position:relative;z-index:1;max-width:1000px;margin:0 auto;padding:0 24px 80px}

/* HEADER */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:28px 0 44px;border-bottom:1px solid rgba(255,255,255,.05);margin-bottom:44px}
.logo{display:flex;align-items:center;gap:12px}
.logo img{height:34px;width:auto;object-fit:contain;filter:drop-shadow(0 0 14px rgba(30,144,255,.5))}
.logo-fb{height:34px;width:34px;background:linear-gradient(135deg,#1E90FF,#00BFFF);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px}
.logo-name{font-family:'Syne',sans-serif;font-size:21px;font-weight:800;color:#fff;letter-spacing:-.3px}
.logo-name b{color:#1E90FF}
.net-tag{font-size:10px;padding:3px 9px;border:1px solid rgba(30,144,255,.25);border-radius:20px;color:rgba(30,144,255,.75);background:rgba(30,144,255,.06);letter-spacing:.5px}
.conn-btn{padding:10px 20px;background:rgba(30,144,255,.09);border:1px solid rgba(30,144,255,.22);border-radius:10px;color:#1E90FF;font-family:'DM Mono',monospace;font-size:13px;cursor:pointer;transition:all .2s;letter-spacing:.2px}
.conn-btn:hover{background:rgba(30,144,255,.17);border-color:rgba(30,144,255,.45)}
.conn-btn.on{background:rgba(0,255,136,.07);border-color:rgba(0,255,136,.22);color:#00ff88}

/* GRID */
.grid{display:grid;grid-template-columns:1fr 370px;gap:24px;align-items:start}

/* LEFT */
.left{display:flex;flex-direction:column;gap:20px}
.sec-label{font-family:'Syne',sans-serif;font-size:11px;font-weight:600;color:rgba(255,255,255,.25);letter-spacing:2px;text-transform:uppercase}

.pipe-card{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.07);border-radius:16px;overflow:hidden}
.pipe-hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 22px 16px;border-bottom:1px solid rgba(255,255,255,.05)}
.pipe-title{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#fff}
.pipe-badge{display:flex;align-items:center;gap:5px;padding:4px 11px;background:rgba(30,144,255,.09);border:1px solid rgba(30,144,255,.18);border-radius:20px;font-size:11px;color:#1E90FF}

.pipe-row{display:flex;align-items:center;justify-content:space-between;padding:13px 22px;transition:background .15s}
.pipe-row:hover{background:rgba(255,255,255,.02)}
.pipe-row+.pipe-row{border-top:1px solid rgba(255,255,255,.04)}
.row-l{display:flex;align-items:center;gap:10px}
.row-ico{width:30px;height:30px;background:rgba(30,144,255,.07);border:1px solid rgba(30,144,255,.13);border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px}
.row-lbl{font-size:13px;color:rgba(255,255,255,.55)}
.row-val{font-size:13px;color:#1E90FF;font-weight:500}

.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.stat{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px;text-align:center}
.stat-n{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#1E90FF;display:block;margin-bottom:3px}
.stat-l{font-size:10px;color:rgba(255,255,255,.28);letter-spacing:.5px;text-transform:uppercase}

.hist-card{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:18px 22px}
.hist-empty{text-align:center;padding:28px 0;color:rgba(255,255,255,.18);font-size:13px}
.hist-item{padding:13px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.hist-item:last-child{border-bottom:none}
.hist-top{display:flex;justify-content:space-between;margin-bottom:5px}
.hist-tag{font-size:11px;color:#1E90FF;background:rgba(30,144,255,.07);border:1px solid rgba(30,144,255,.13);border-radius:20px;padding:2px 9px}
.hist-time{font-size:11px;color:rgba(255,255,255,.22)}
.hist-det{font-size:12px;color:rgba(255,255,255,.4);margin-bottom:5px}
.hist-link{font-size:11px;color:rgba(30,144,255,.45);text-decoration:none}
.hist-link:hover{color:#1E90FF}

/* FORM */
.form-card{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:26px;position:sticky;top:24px}
.form-title{font-family:'Syne',sans-serif;font-size:19px;font-weight:800;color:#fff;margin-bottom:3px}
.form-sub{font-size:11px;color:rgba(255,255,255,.28);margin-bottom:22px;letter-spacing:.2px}

.toks{display:flex;gap:8px;margin-bottom:18px}
.tok{flex:1;padding:10px 0;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:9px;color:rgba(255,255,255,.38);font-family:'DM Mono',monospace;font-size:13px;cursor:pointer;transition:all .2s}
.tok:hover{border-color:rgba(30,144,255,.28);color:rgba(255,255,255,.65)}
.tok.on{background:rgba(30,144,255,.11);border-color:rgba(30,144,255,.38);color:#1E90FF}

.fld{margin-bottom:15px}
.fld label{display:block;font-size:10px;color:rgba(255,255,255,.3);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:7px}
.fld input{width:100%;padding:13px 13px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;color:#fff;font-family:'DM Mono',monospace;font-size:14px;outline:none;transition:border-color .2s}
.fld input:focus{border-color:rgba(30,144,255,.38)}
.fld input::placeholder{color:rgba(255,255,255,.18)}

.fee-row{display:flex;justify-content:space-between;padding:9px 12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:8px;margin-bottom:18px}
.fee-l{font-size:11px;color:rgba(255,255,255,.28)}
.fee-v{font-size:11px;color:rgba(255,255,255,.45)}

.send-btn{width:100%;padding:15px;background:linear-gradient(135deg,#1E90FF,#0062cc);border:none;border-radius:12px;color:#fff;font-family:'Syne',sans-serif;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s;box-shadow:0 4px 24px rgba(30,144,255,.22);letter-spacing:.2px}
.send-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 32px rgba(30,144,255,.35)}
.send-btn:disabled{opacity:.5;cursor:not-allowed}

.status-box{margin-top:15px;padding:13px;background:rgba(30,144,255,.06);border:1px solid rgba(30,144,255,.16);border-radius:10px}
.status-box pre{font-family:'DM Mono',monospace;font-size:12px;color:#1E90FF;white-space:pre-wrap;margin:0;line-height:1.65}

@media(max-width:760px){
  .grid{grid-template-columns:1fr}
  .form-card{position:static}
}
`;

export default function App() {
  const [account, setAccount] = useState(null);
  const [amount, setAmount]   = useState("");
  const [recipient, setRecipient] = useState("");
  const [token, setToken]     = useState("ETH");
  const [status, setStatus]   = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [pendingId, setPendingId] = useState(null);
  const [logoErr, setLogoErr] = useState(false);

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
          setStatus("✅ Concluído! Todos os hops entregues.");
          clearInterval(iv);
          setPendingId(null);
        } else {
          setStatus(`⏳ Processando...\n${d.hopsFeitos}/${d.hopsTotal} hops · ~${d.minutosRestantes}min restantes`);
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
    if (!account)            return alert("Conecte sua carteira.");
    if (!amount || !recipient) return alert("Preencha todos os campos.");
    setLoading(true);
    setStatus("🔒 Iniciando pipeline de privacidade...");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      let txHash;

      if (token === "ETH") {
        const tx = await contract.depositETH(recipient, { value: ethers.parseEther(amount) });
        await tx.wait(); txHash = tx.hash;
      } else {
        const t = TOKENS[token];
        const tc = new ethers.Contract(t.address, ERC20_ABI, signer);
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
        splits: data.splits, hops: data.hopsTotal,
        time: new Date().toLocaleTimeString("pt-BR"),
      }, ...h]);

      setStatus(`👻 Pipeline iniciado!\n${data.splits} splits · ${data.hopsTotal} hops\nEstimativa: ~${data.estimativaMinutos} min`);
      setAmount(""); setRecipient("");
    } catch (e) {
      setStatus("❌ " + (e.reason || e.message));
    }
    setLoading(false);
  };

  const fee = amount ? `≈ ${(parseFloat(amount)*0.002).toFixed(6)} ${token}` : "—";

  return (
    <>
      <div className="bg" />
      <div className="wrap">

        <header className="hdr">
          <div className="logo">
            {!logoErr
              ? <img src={LOGO_URL} alt="SilentFlow" onError={() => setLogoErr(true)} />
              : <div className="logo-fb">👻</div>}
            <span className="logo-name">Silent<b>Flow</b></span>
            <span className="net-tag">SEPOLIA</span>
          </div>
          <button className={`conn-btn${account ? " on" : ""}`} onClick={connect}>
            {account ? `● ${account.slice(0,6)}...${account.slice(-4)}` : "Conectar Carteira"}
          </button>
        </header>

        <div className="grid">

          {/* LEFT */}
          <div className="left">
            <span className="sec-label">Privacidade</span>

            <div className="pipe-card">
              <div className="pipe-hdr">
                <span className="pipe-title">Pipeline Ativo</span>
                <span className="pipe-badge">🔒 v2</span>
              </div>
              {[
                ["✂️","Split automático",    "2–4 partes aleatórias"],
                ["🔀","Multi-hop por parte", "2–3 endereços efêmeros"],
                ["⏱","Delay por hop",       "1–10 minutos"],
                ["🎭","Dummy transactions",  "ruído entre hops"],
              ].map(([ico, lbl, val]) => (
                <div className="pipe-row" key={lbl}>
                  <div className="row-l">
                    <div className="row-ico">{ico}</div>
                    <span className="row-lbl">{lbl}</span>
                  </div>
                  <span className="row-val">{val}</span>
                </div>
              ))}
            </div>

            <div className="stats">
              {[["0.2%","Taxa"],["≤10m","Estimativa"],["3","Tokens"]].map(([n,l]) => (
                <div className="stat" key={l}>
                  <span className="stat-n">{n}</span>
                  <span className="stat-l">{l}</span>
                </div>
              ))}
            </div>

            <span className="sec-label" style={{marginTop:4}}>Histórico</span>
            <div className="hist-card">
              {history.length === 0
                ? <div className="hist-empty">Nenhuma transação ainda</div>
                : history.map(tx => (
                  <div className="hist-item" key={tx.id}>
                    <div className="hist-top">
                      <span className="hist-tag">👻 {tx.splits} splits · {tx.hops} hops</span>
                      <span className="hist-time">{tx.time}</span>
                    </div>
                    <div className="hist-det">{tx.amount} {tx.token} → {tx.recipient}</div>
                    <a className="hist-link" href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noreferrer">
                      Ver no Etherscan ↗
                    </a>
                  </div>
                ))
              }
            </div>
          </div>

          {/* FORM */}
          <div className="form-card">
            <div className="form-title">Envio Privado</div>
            <div className="form-sub">Sem rastreabilidade · Non-custodial</div>

            <div className="toks">
              {Object.keys(TOKENS).map(t => (
                <button key={t} className={`tok${token===t?" on":""}`} onClick={() => setToken(t)}>{t}</button>
              ))}
            </div>

            <div className="fld">
              <label>Valor</label>
              <input type="number" placeholder={`0.00 ${token}`} value={amount} onChange={e=>setAmount(e.target.value)} />
            </div>

            <div className="fld">
              <label>Destinatário</label>
              <input type="text" placeholder="0x..." value={recipient} onChange={e=>setRecipient(e.target.value)} />
            </div>

            <div className="fee-row">
              <span className="fee-l">Taxa de privacidade · 0.2%</span>
              <span className="fee-v">{fee}</span>
            </div>

            <button className="send-btn" onClick={send} disabled={loading || !account}>
              {loading ? "⏳ Processando..." : "👻 Enviar com Privacidade"}
            </button>

            {status && <div className="status-box"><pre>{status}</pre></div>}
          </div>

        </div>
      </div>
    </>
  );
}
