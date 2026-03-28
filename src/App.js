import { useState, useEffect } from "react";
import { ethers } from "ethers";

const CONTRACT_ADDRESS = "0x99f4a6Deb7643a1DDa10115BFE3c7a4D9C4Ef09B";
const BACKEND_URL = "https://silentflow-production.up.railway.app";

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
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Mono:wght@300;400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#050810;color:#dde1ec;font-family:'DM Mono',monospace;min-height:100vh}

.bg{position:fixed;inset:0;z-index:0;pointer-events:none}
.bg::before{content:'';position:absolute;width:900px;height:500px;top:-200px;left:50%;transform:translateX(-50%);background:radial-gradient(ellipse,rgba(30,144,255,.055) 0%,transparent 68%)}
.bg::after{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:50%;height:1px;background:linear-gradient(90deg,transparent,rgba(30,144,255,.3),transparent)}

.wrap{position:relative;z-index:1;max-width:980px;margin:0 auto;padding:0 28px 100px}

/* HEADER */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:30px 0 42px;border-bottom:1px solid rgba(255,255,255,.04);margin-bottom:48px}
.logo{display:flex;align-items:center;gap:14px}
.logo img{height:32px;width:auto;object-fit:contain}
.net{font-size:10px;padding:3px 9px;border:1px solid rgba(255,255,255,.1);border-radius:20px;color:rgba(255,255,255,.3);letter-spacing:.8px}
.conn-btn{padding:10px 20px;background:transparent;border:1px solid rgba(255,255,255,.12);border-radius:10px;color:rgba(255,255,255,.5);font-family:'DM Mono',monospace;font-size:13px;cursor:pointer;transition:all .2s;letter-spacing:.2px}
.conn-btn:hover{border-color:rgba(255,255,255,.25);color:rgba(255,255,255,.8)}
.conn-btn.on{border-color:rgba(0,220,100,.25);color:#00dc64;background:rgba(0,220,100,.05)}

/* LAYOUT */
.grid{display:grid;grid-template-columns:1fr 360px;gap:28px;align-items:start}

/* LEFT */
.left{display:flex;flex-direction:column;gap:16px}

.hist-card{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:22px 24px}
.hist-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:rgba(255,255,255,.35);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:18px}
.hist-empty{color:rgba(255,255,255,.18);font-size:13px;text-align:center;padding:24px 0}
.hist-item{padding:14px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.hist-item:last-child{border-bottom:none}
.hist-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}
.hist-amt{font-size:15px;font-weight:500;color:#dde1ec}
.hist-time{font-size:11px;color:rgba(255,255,255,.2)}
.hist-to{font-size:12px;color:rgba(255,255,255,.35);margin-bottom:6px}
.hist-status{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:2px 9px;border-radius:20px}
.hist-status.done{background:rgba(0,220,100,.07);border:1px solid rgba(0,220,100,.15);color:#00dc64}
.hist-status.proc{background:rgba(30,144,255,.07);border:1px solid rgba(30,144,255,.15);color:#4da6ff}
.hist-link{float:right;font-size:11px;color:rgba(255,255,255,.25);text-decoration:none;transition:color .2s}
.hist-link:hover{color:rgba(255,255,255,.55)}

/* privacy details - collapsed at bottom */
.details-toggle{display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:14px 18px;background:rgba(255,255,255,.015);border:1px solid rgba(255,255,255,.05);border-radius:12px;transition:background .2s;user-select:none}
.details-toggle:hover{background:rgba(255,255,255,.03)}
.details-toggle-label{font-size:12px;color:rgba(255,255,255,.3);letter-spacing:.3px}
.details-toggle-icon{font-size:11px;color:rgba(255,255,255,.2);transition:transform .25s}
.details-toggle-icon.open{transform:rotate(180deg)}
.details-body{overflow:hidden;transition:max-height .3s ease,opacity .3s ease}
.details-body.closed{max-height:0;opacity:0;pointer-events:none}
.details-body.open{max-height:300px;opacity:1}
.details-inner{padding:4px 0 0}
.detail-row{display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-bottom:1px solid rgba(255,255,255,.03)}
.detail-row:last-child{border-bottom:none}
.detail-k{font-size:12px;color:rgba(255,255,255,.3)}
.detail-v{font-size:12px;color:rgba(255,255,255,.5)}

/* FORM CARD */
.form-card{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:28px;position:sticky;top:24px}
.form-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:#fff;margin-bottom:2px;letter-spacing:-.3px}
.form-sub{font-size:11px;color:rgba(255,255,255,.25);margin-bottom:26px}

.toks{display:flex;gap:6px;margin-bottom:20px}
.tok{flex:1;padding:9px 0;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;color:rgba(255,255,255,.35);font-family:'DM Mono',monospace;font-size:13px;cursor:pointer;transition:all .2s;font-weight:400}
.tok:hover{border-color:rgba(255,255,255,.15);color:rgba(255,255,255,.6)}
.tok.on{background:rgba(30,144,255,.1);border-color:rgba(30,144,255,.35);color:#4da6ff}

.fld{margin-bottom:14px}
.fld label{display:block;font-size:10px;color:rgba(255,255,255,.28);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:7px}
.fld input{width:100%;padding:13px 14px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:10px;color:#fff;font-family:'DM Mono',monospace;font-size:14px;outline:none;transition:border-color .2s}
.fld input:focus{border-color:rgba(30,144,255,.35);background:rgba(30,144,255,.04)}
.fld input::placeholder{color:rgba(255,255,255,.15)}

.divider{height:1px;background:rgba(255,255,255,.05);margin:18px 0}

.fee-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.fee-l{font-size:12px;color:rgba(255,255,255,.25)}
.fee-v{font-size:12px;color:rgba(255,255,255,.4)}

.send-btn{width:100%;padding:15px;background:linear-gradient(135deg,#1a7fe8,#0055bb);border:none;border-radius:11px;color:#fff;font-family:'Syne',sans-serif;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s;letter-spacing:.2px;box-shadow:0 2px 20px rgba(30,144,255,.18)}
.send-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 28px rgba(30,144,255,.28)}
.send-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}

.status-box{margin-top:14px;padding:12px 14px;background:rgba(30,144,255,.05);border:1px solid rgba(30,144,255,.14);border-radius:10px}
.status-box pre{font-family:'DM Mono',monospace;font-size:12px;color:#4da6ff;white-space:pre-wrap;margin:0;line-height:1.6}
.status-box.ok{background:rgba(0,220,100,.05);border-color:rgba(0,220,100,.14)}
.status-box.ok pre{color:#00dc64}
.status-box.err{background:rgba(255,80,80,.05);border-color:rgba(255,80,80,.14)}
.status-box.err pre{color:#ff6b6b}

@media(max-width:740px){
  .grid{grid-template-columns:1fr}
  .form-card{position:static}
  .hdr{padding:20px 0 32px;margin-bottom:32px}
}
`;

export default function App() {
  const [account, setAccount]     = useState(null);
  const [amount, setAmount]       = useState("");
  const [recipient, setRecipient] = useState("");
  const [token, setToken]         = useState("ETH");
  const [status, setStatus]       = useState("");
  const [statusType, setStatusType] = useState(""); // "", "ok", "err"
  const [loading, setLoading]     = useState(false);
  const [history, setHistory]     = useState([]);
  const [pendingId, setPendingId] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

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
        const t  = TOKENS[token];
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
        time: new Date().toLocaleTimeString("pt-BR"),
        done: false,
      }, ...h]);

      setStatus(`Enviando ${amount} ${token} com privacidade.\nEstimativa: ~${data.estimativaMinutos} minutos.`);
      setStatusType("");
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
      <div className="bg" />
      <div className="wrap">

        <header className="hdr">
          <div className="logo">
            <img src="/logo.png" alt="SilentFlow" />
            <span className="net">SEPOLIA TESTNET</span>
          </div>
          <button className={`conn-btn${account ? " on" : ""}`} onClick={connect}>
            {account ? `● ${account.slice(0,6)}...${account.slice(-4)}` : "Conectar Carteira"}
          </button>
        </header>

        <div className="grid">

          {/* LEFT */}
          <div className="left">

            {/* History */}
            <div className="hist-card">
              <div className="hist-title">Histórico</div>
              {history.length === 0
                ? <div className="hist-empty">Nenhuma transação ainda</div>
                : history.map(tx => (
                  <div className="hist-item" key={tx.id}>
                    <div className="hist-row">
                      <span className="hist-amt">{tx.amount} {tx.token}</span>
                      <span className="hist-time">{tx.time}</span>
                    </div>
                    <div className="hist-to">→ {tx.recipient}</div>
                    <span className={`hist-status ${tx.done ? "done" : "proc"}`}>
                      {tx.done ? "Entregue" : "Processando"}
                    </span>
                    <a className="hist-link" href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noreferrer">
                      Etherscan ↗
                    </a>
                  </div>
                ))
              }
            </div>

            {/* Privacy details — collapsed */}
            <div>
              <div
                className="details-toggle"
                onClick={() => setDetailsOpen(o => !o)}
              >
                <span className="details-toggle-label">Como funciona a privacidade</span>
                <span className={`details-toggle-icon${detailsOpen ? " open" : ""}`}>▼</span>
              </div>
              <div className={`details-body ${detailsOpen ? "open" : "closed"}`}>
                <div className="details-inner">
                  {[
                    ["Split automático",    "2–4 partes aleatórias"],
                    ["Multi-hop",           "2–3 endereços efêmeros por parte"],
                    ["Delay",               "1–10 minutos por hop"],
                    ["Dummy transactions",  "ruído entre hops reais"],
                    ["Taxa",                "0.2% por transação"],
                  ].map(([k, v]) => (
                    <div className="detail-row" key={k}>
                      <span className="detail-k">{k}</span>
                      <span className="detail-v">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>

          {/* FORM */}
          <div className="form-card">
            <div className="form-title">Envio Privado</div>
            <div className="form-sub">Non-custodial · Sepolia testnet</div>

            <div className="toks">
              {Object.keys(TOKENS).map(t => (
                <button key={t} className={`tok${token===t?" on":""}`} onClick={() => setToken(t)}>{t}</button>
              ))}
            </div>

            <div className="fld">
              <label>Valor</label>
              <input
                type="number"
                placeholder={`0.00`}
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>

            <div className="fld">
              <label>Destinatário</label>
              <input
                type="text"
                placeholder="0x..."
                value={recipient}
                onChange={e => setRecipient(e.target.value)}
              />
            </div>

            <div className="divider" />

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
      </div>
    </>
  );
}
