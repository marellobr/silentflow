import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";

const CONTRACT_ADDRESS = "0xAdcBABf7CB3cE55559b2A3ca81f75bbBC147565b";
const BACKEND_URL = "https://silentflow-production.up.railway.app";

const ABI = [
  "function depositETH(address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external payable",
  "function depositToken(address token, uint256 amount, address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external",
  "function withdraw(address token, address recipient) external",
  "function withdrawFor(address stealthAddress, address token, address recipient, bytes calldata sig) external",
  "function withdrawNonces(address) external view returns (uint256)",
  "function balanceOf(address stealthAddress, address token) external view returns (uint256)",
  "event StealthDeposit(bytes ephemeralPubKey, address indexed stealthAddress, address token, uint256 amount, uint8 viewTag)",
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

// ── Stealth crypto helpers ─────────────────────────────────────────────────────

function generateStealthKeys() {
  const spendingWallet = ethers.Wallet.createRandom();
  const viewingWallet  = ethers.Wallet.createRandom();
  return {
    spendingPrivKey: spendingWallet.privateKey,
    spendingPubKey:  ethers.SigningKey.computePublicKey(spendingWallet.privateKey, true),
    viewingPrivKey:  viewingWallet.privateKey,
    viewingPubKey:   ethers.SigningKey.computePublicKey(viewingWallet.privateKey, true),
    metaAddress: `st:${ethers.SigningKey.computePublicKey(spendingWallet.privateKey, true)}:${ethers.SigningKey.computePublicKey(viewingWallet.privateKey, true)}`,
  };
}

function deriveStealthAddress(metaAddress) {
  const parts = metaAddress.replace("st:", "").split(":");
  if (parts.length !== 2) throw new Error("Link de pagamento invalido");
  const [spendingPubKey, viewingPubKey] = parts;
  const ephemeralWallet = ethers.Wallet.createRandom();
  const ephemeralPubKey = ethers.SigningKey.computePublicKey(ephemeralWallet.privateKey, true);
  const h = ethers.keccak256(ethers.concat([ethers.getBytes(ephemeralPubKey), ethers.getBytes(viewingPubKey)]));
  const stealthSeed = ethers.keccak256(ethers.concat([ethers.getBytes(h), ethers.getBytes(spendingPubKey)]));
  const stealthAddress = new ethers.Wallet(stealthSeed).address;
  const viewTag = parseInt(h.slice(2, 4), 16);
  return { stealthAddress, ephemeralPubKey, viewTag };
}

function tryDecryptDeposit(ephemeralPubKeyHex, stealthAddressOnChain, viewTagOnChain, spendingPrivKey, viewingPrivKey) {
  try {
    if (viewTagOnChain === 0) return null;
    const viewingPubKey  = ethers.SigningKey.computePublicKey(viewingPrivKey, true);
    const spendingPubKey = ethers.SigningKey.computePublicKey(spendingPrivKey, true);
    const h = ethers.keccak256(ethers.concat([ethers.getBytes(ephemeralPubKeyHex), ethers.getBytes(viewingPubKey)]));
    if (parseInt(h.slice(2, 4), 16) !== viewTagOnChain) return null;
    const stealthSeed = ethers.keccak256(ethers.concat([ethers.getBytes(h), ethers.getBytes(spendingPubKey)]));
    const stealthWallet = new ethers.Wallet(stealthSeed);
    if (stealthWallet.address.toLowerCase() !== stealthAddressOnChain.toLowerCase()) return null;
    return { stealthAddress: stealthWallet.address, stealthPrivKey: stealthSeed };
  } catch { return null; }
}

// ── Crypto backup helpers (senha) ─────────────────────────────────────────────

async function encryptKeys(keys, password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(keys));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, data);
  return {
    v: 1,
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(encrypted)),
  };
}

async function decryptKeys(payload, password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const salt = new Uint8Array(payload.salt);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
  const iv = new Uint8Array(payload.iv);
  const data = new Uint8Array(payload.data);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, data);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// ── Link de pagamento ─────────────────────────────────────────────────────────

function buildPayLink(metaAddress) {
  return `${window.location.origin}/p/${encodeURIComponent(metaAddress)}`;
}

function parsePayLink(href) {
  // Aceita: URL /p/st:..., ou o meta-address direto
  try {
    const url = new URL(href);
    const parts = url.pathname.split("/p/");
    if (parts[1]) return decodeURIComponent(parts[1]);
  } catch {}
  if (href.startsWith("st:")) return href;
  return null;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@300;400;500&display=swap');

:root {
  --bg: #080b12;
  --surface: #0d1117;
  --surface2: #111820;
  --border: rgba(255,255,255,.06);
  --border2: rgba(255,255,255,.1);
  --blue: #3b82f6;
  --blue-dim: rgba(59,130,246,.12);
  --blue-glow: rgba(59,130,246,.25);
  --green: #22c55e;
  --green-dim: rgba(34,197,94,.1);
  --amber: #f59e0b;
  --text: #e2e8f0;
  --text2: rgba(226,232,240,.5);
  --text3: rgba(226,232,240,.25);
  --r: 14px;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:'Space Grotesk',sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}

.bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.bg::before{content:'';position:absolute;width:800px;height:800px;top:-300px;left:50%;transform:translateX(-50%);background:radial-gradient(ellipse,rgba(59,130,246,.05) 0%,transparent 60%);border-radius:50%}
.bg::after{content:'';position:absolute;bottom:-200px;right:-100px;width:600px;height:600px;background:radial-gradient(ellipse,rgba(59,130,246,.03) 0%,transparent 60%);border-radius:50%}

.wrap{position:relative;z-index:1;max-width:1060px;margin:0 auto;padding:0 24px 80px}

/* HEADER */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:20px 0;border-bottom:1px solid var(--border);margin-bottom:36px}
.logo{display:flex;align-items:center;gap:10px}
.logo img{height:52px;width:auto;object-fit:contain;filter:drop-shadow(0 0 14px var(--blue-glow))}
.hdr-right{display:flex;align-items:center;gap:8px}
.net-badge{display:flex;align-items:center;gap:5px;padding:5px 10px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.15);border-radius:20px;font-size:11px;color:var(--green);letter-spacing:.5px;font-weight:500}
.net-badge::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);animation:blink 2s ease-in-out infinite;flex-shrink:0}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
.conn-btn{padding:8px 16px;background:var(--surface2);border:1px solid var(--border2);border-radius:20px;color:var(--text2);font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:500;cursor:pointer;transition:all .2s}
.conn-btn:hover{border-color:var(--blue);color:var(--text)}
.conn-btn.on{border-color:rgba(34,197,94,.3);color:var(--green);background:var(--green-dim)}

/* TABS */
.tabs{display:flex;gap:2px;margin-bottom:28px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:3px;width:fit-content}
.tab{padding:9px 28px;background:transparent;border:none;border-radius:10px;color:var(--text3);font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:all .2s}
.tab:hover{color:var(--text2)}
.tab.on{background:var(--surface2);color:var(--text);border:1px solid var(--border2);box-shadow:0 1px 8px rgba(0,0,0,.3)}

/* GRID */
.grid{display:grid;grid-template-columns:1fr 380px;gap:20px;align-items:start}
.left{display:flex;flex-direction:column;gap:16px}
.sec-label{font-size:11px;font-weight:600;color:var(--text3);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px}

/* CARDS */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.card-body{padding:6px 0}
.hist-empty{text-align:center;padding:32px 0;color:var(--text3);font-size:13px}
.hist-item{padding:14px 18px;border-bottom:1px solid var(--border);transition:background .15s}
.hist-item:hover{background:rgba(255,255,255,.015)}
.hist-item:last-child{border-bottom:none}
.hist-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:3px}
.hist-amt{font-size:15px;font-weight:600;color:var(--text)}
.hist-time{font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace}
.hist-to{font-size:12px;color:var(--text3);margin-bottom:8px;font-family:'JetBrains Mono',monospace}
.hist-foot{display:flex;align-items:center;justify-content:space-between}
.pill{font-size:11px;padding:3px 10px;border-radius:20px;font-weight:500}
.pill.done{background:var(--green-dim);border:1px solid rgba(34,197,94,.2);color:var(--green)}
.pill.proc{background:var(--blue-dim);border:1px solid rgba(59,130,246,.2);color:var(--blue)}
.hist-link{font-size:11px;color:var(--text3);text-decoration:none;transition:color .2s;font-weight:500}
.hist-link:hover{color:var(--blue)}

/* INFO ACCORDION */
.info-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.info-toggle{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;cursor:pointer;user-select:none;transition:background .15s}
.info-toggle:hover{background:rgba(255,255,255,.02)}
.info-label{font-size:13px;color:var(--text2);font-weight:500}
.info-arrow{font-size:10px;color:var(--text3);transition:transform .25s}
.info-arrow.open{transform:rotate(180deg)}
.info-body{max-height:0;overflow:hidden;transition:max-height .35s ease,opacity .35s;opacity:0}
.info-body.open{max-height:400px;opacity:1}
.info-row{display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-top:1px solid var(--border)}
.info-k{font-size:12px;color:var(--text3);font-weight:500}
.info-v{font-size:12px;color:var(--text2);font-family:'JetBrains Mono',monospace}

/* FORM CARD */
.form-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px;position:sticky;top:20px}
.form-title{font-size:18px;font-weight:700;color:var(--text);margin-bottom:2px}
.form-sub{font-size:12px;color:var(--text3);margin-bottom:20px;font-weight:400}

/* TOKEN SELECTOR */
.toks{display:flex;gap:6px;margin-bottom:16px}
.tok{flex:1;padding:8px 0;background:transparent;border:1px solid var(--border);border-radius:8px;color:var(--text3);font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:500;cursor:pointer;transition:all .2s}
.tok:hover{border-color:var(--border2);color:var(--text2)}
.tok.on{background:var(--blue-dim);border-color:rgba(59,130,246,.35);color:var(--blue)}

/* INPUTS */
.fld{margin-bottom:14px}
.fld label{display:block;font-size:11px;font-weight:600;color:var(--text3);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px}
.fld input,.fld textarea{width:100%;padding:11px 13px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:13px;outline:none;transition:all .2s;resize:none}
.fld input:focus,.fld textarea:focus{border-color:rgba(59,130,246,.4);background:rgba(59,130,246,.02)}
.fld input::placeholder,.fld textarea::placeholder{color:var(--text3)}

.sep{height:1px;background:var(--border);margin:16px 0}
.fee-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.fee-l{font-size:12px;color:var(--text3)}
.fee-v{font-size:12px;color:var(--text2);font-family:'JetBrains Mono',monospace}

/* BUTTONS */
.primary-btn{width:100%;padding:13px;background:var(--blue);border:none;border-radius:10px;color:#fff;font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s;box-shadow:0 2px 16px rgba(59,130,246,.2)}
.primary-btn:hover:not(:disabled){background:#2563eb;box-shadow:0 4px 24px rgba(59,130,246,.35);transform:translateY(-1px)}
.primary-btn:active:not(:disabled){transform:translateY(0)}
.primary-btn:disabled{opacity:.35;cursor:not-allowed;transform:none}
.ghost-btn{width:100%;padding:11px;background:transparent;border:1px solid var(--border);border-radius:10px;color:var(--text2);font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:500;cursor:pointer;transition:all .2s;margin-top:8px}
.ghost-btn:hover{border-color:var(--border2);color:var(--text)}
.danger-btn{color:rgba(239,68,68,.5);border-color:rgba(239,68,68,.15)}
.danger-btn:hover{color:rgba(239,68,68,.8);border-color:rgba(239,68,68,.3)}

/* STATUS */
.status-box{margin-top:12px;padding:12px 14px;border-radius:10px;background:var(--blue-dim);border:1px solid rgba(59,130,246,.15)}
.status-box pre{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--blue);white-space:pre-wrap;margin:0;line-height:1.7}
.status-box.ok{background:var(--green-dim);border-color:rgba(34,197,94,.2)}
.status-box.ok pre{color:var(--green)}
.status-box.err{background:rgba(239,68,68,.06);border-color:rgba(239,68,68,.15)}
.status-box.err pre{color:#f87171}

/* RECEIVE — LINK BOX */
.link-box{background:var(--bg);border:1px solid rgba(59,130,246,.25);border-radius:12px;padding:16px;margin-bottom:14px}
.link-box-label{font-size:10px;font-weight:600;color:var(--text3);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px}
.link-url{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--blue);word-break:break-all;line-height:1.7;cursor:pointer;transition:color .2s}
.link-url:hover{color:#60a5fa}
.link-actions{display:flex;gap:8px;margin-top:10px}
.link-btn{flex:1;padding:8px;background:var(--blue-dim);border:1px solid rgba(59,130,246,.2);border-radius:8px;color:var(--blue);font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;text-align:center}
.link-btn:hover{background:rgba(59,130,246,.2)}
.link-copied{color:var(--green);border-color:rgba(34,197,94,.2);background:var(--green-dim)}

/* RECEIVE — DEPOSITS */
.deposit-item{padding:16px 18px;border-bottom:1px solid var(--border)}
.deposit-item:last-child{border-bottom:none}
.deposit-header{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}
.deposit-amt{font-size:18px;font-weight:700;color:var(--green)}
.deposit-token{font-size:12px;color:var(--text3);font-weight:600}
.deposit-addr{font-size:11px;color:var(--text3);margin-bottom:10px;font-family:'JetBrains Mono',monospace}

/* MODAL — BACKUP */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px}
.modal{background:var(--surface);border:1px solid var(--border2);border-radius:20px;padding:28px;width:100%;max-width:420px}
.modal-title{font-size:16px;font-weight:700;color:var(--text);margin-bottom:6px}
.modal-sub{font-size:12px;color:var(--text3);margin-bottom:20px;line-height:1.6}
.modal-close{float:right;background:none;border:none;color:var(--text3);font-size:18px;cursor:pointer;margin-top:-4px}
.modal-actions{display:flex;gap:8px;margin-top:16px}
.modal-actions .primary-btn{margin:0}
.modal-actions .ghost-btn{margin:0}
.modal-err{font-size:12px;color:#f87171;margin-top:8px}

/* WARNING */
.warning-box{background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.15);border-radius:10px;padding:12px 14px}
.warning-box p{font-size:12px;color:rgba(245,158,11,.8);line-height:1.6}

/* NO KEYS */
.no-keys{text-align:center;padding:12px 0 6px}
.no-keys-icon{font-size:32px;margin-bottom:12px;opacity:.4}
.no-keys-title{font-size:15px;font-weight:600;color:var(--text2);margin-bottom:6px}
.no-keys-sub{font-size:12px;color:var(--text3);margin-bottom:20px;line-height:1.6}

/* FOOTER */
.footer{margin-top:60px;padding-top:20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.footer-l{font-size:13px;font-weight:700;color:var(--blue);letter-spacing:1px}
.footer-r{display:flex;gap:20px}
.footer-link{font-size:12px;color:var(--text3);text-decoration:none;transition:color .2s;font-weight:500}
.footer-link:hover{color:var(--text2)}

@media(max-width:760px){
  .grid{grid-template-columns:1fr}
  .form-card{position:static}
  .hdr{padding:16px 0;margin-bottom:24px}
  .tabs{width:100%}
  .tab{flex:1;text-align:center}
}
`;

// ── App ────────────────────────────────────────────────────────────────────────
export default function App() {
  const [account, setAccount]         = useState(null);
  const [tab, setTab]                 = useState("send");

  // Send
  const [amount, setAmount]           = useState("");
  const [payLink, setPayLink]         = useState(""); // recebe link ou meta-address
  const [token, setToken]             = useState("ETH");
  const [status, setStatus]           = useState("");
  const [statusType, setStatusType]   = useState("");
  const [loading, setLoading]         = useState(false);
  const [history, setHistory]         = useState([]);
  const [pendingId, setPendingId]     = useState(null);
  const [accordOpen, setAccordOpen]   = useState(false);

  // Receive
  const [myKeys, setMyKeys]           = useState(null);
  const [scanning, setScanning]       = useState(false);
  const [deposits, setDeposits]       = useState([]);
  const [withdrawing, setWithdrawing] = useState(null);
  const [linkCopied, setLinkCopied]   = useState(false);

  // Backup modal
  const [modal, setModal]             = useState(null); // "export" | "import"
  const [modalPwd, setModalPwd]       = useState("");
  const [modalPwd2, setModalPwd2]     = useState("");
  const [modalErr, setModalErr]       = useState("");
  const [modalFile, setModalFile]     = useState(null);

  // Detecta link de pagamento na URL (/p/st:...)
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/p\/(.+)$/);
    if (match) {
      const meta = decodeURIComponent(match[1]);
      if (meta.startsWith("st:")) {
        setPayLink(meta);
        setTab("send");
      }
    }
  }, []);

  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = STYLE;
    document.head.appendChild(s);
    return () => document.head.removeChild(s);
  }, []);

  // Carrega chaves do localStorage ao iniciar
  useEffect(() => {
    const saved = localStorage.getItem("sf_keys");
    if (saved) {
      try { setMyKeys(JSON.parse(saved)); } catch {}
    }
  }, []);

  // Salva chaves no localStorage sempre que mudam
  useEffect(() => {
    if (myKeys) localStorage.setItem("sf_keys", JSON.stringify(myKeys));
  }, [myKeys]);

  // Poll status
  useEffect(() => {
    if (!pendingId) return;
    if (pendingId.startsWith("entrada_")) {
      const endereco = pendingId.replace("entrada_", "");
      const iv = setInterval(async () => {
        try {
          const r = await fetch(`${BACKEND_URL}/aguardar/${endereco}`);
          const d = await r.json();
          if (d.recebido && d.id) { setPendingId(d.id); clearInterval(iv); }
        } catch {}
      }, 12000);
      return () => clearInterval(iv);
    }
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/status/${pendingId}`);
        const d = await r.json();
        if (d.concluido) {
          setStatus("Enviado com sucesso. O destinatario pode sacar a qualquer momento.");
          setStatusType("ok");
          clearInterval(iv); setPendingId(null);
          setHistory(h => h.map(t => t.id === pendingId ? { ...t, done: true } : t));
        } else {
          setStatus(`Processando... ${d.hopsFeitos}/${d.hopsTotal} etapas - ~${d.minutosRestantes} min restantes`);
        }
      } catch {}
    }, 15000);
    return () => clearInterval(iv);
  }, [pendingId]);

  const connect = async () => {
    if (!window.ethereum) return alert("MetaMask nao encontrada.");
    const p = new ethers.BrowserProvider(window.ethereum);
    const [acc] = await p.send("eth_requestAccounts", []);
    setAccount(acc);
  };

  // ── SEND ──────────────────────────────────────────────────────────────────
  const send = async () => {
    if (!account) return alert("Conecte sua carteira.");
    if (!amount || !payLink) return alert("Preencha o valor e o link de pagamento.");
    setLoading(true); setStatus("Iniciando envio privado..."); setStatusType("");
    try {
      const metaAddress = parsePayLink(payLink);
      if (!metaAddress) throw new Error("Link de pagamento invalido. Cole o link ou o endereco st:...");

      const { stealthAddress, ephemeralPubKey, viewTag } = deriveStealthAddress(metaAddress);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();

      setStatus("Gerando endereco de entrada privado...");
      const entradaRes = await fetch(
        `${BACKEND_URL}/entrada?token=${token}&stealthAddress=${stealthAddress}&ephemeralPubKey=${ephemeralPubKey}&viewTag=${viewTag}`
      );
      const entradaData = await entradaRes.json();
      if (entradaData.erro) throw new Error(entradaData.erro);
      const { entradaAddress } = entradaData;

      let txHash;
      let valorWei;

      if (token === "ETH") {
        valorWei = ethers.parseEther(amount);
        setStatus("Aguardando confirmacao na carteira...");
        const tx = await signer.sendTransaction({ to: entradaAddress, value: valorWei });
        setStatus("Confirmando transacao...");
        await tx.wait();
        txHash = tx.hash;
      } else {
        const t = TOKENS[token];
        valorWei = ethers.parseUnits(amount, t.decimals);
        const tc = new ethers.Contract(t.address, ERC20_ABI, signer);
        setStatus("Aguardando aprovacao do token...");
        const allow = await tc.allowance(account, entradaAddress);
        if (allow < valorWei) { const a = await tc.approve(entradaAddress, valorWei); await a.wait(); }
        setStatus("Transferindo tokens...");
        const transferTx = await tc.transfer(entradaAddress, valorWei);
        await transferTx.wait();
        txHash = transferTx.hash;
      }

      setStatus("Aguardando deteccao pelo pipeline...");
      let pipelineId = null;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 12000));
        const pollRes  = await fetch(`${BACKEND_URL}/aguardar/${entradaAddress}`);
        const pollData = await pollRes.json();
        if (pollData.recebido && pollData.id) { pipelineId = pollData.id; break; }
        setStatus(`Aguardando deteccao... (${i + 1}/30)`);
      }

      if (!pipelineId) pipelineId = `entrada_${entradaAddress}`;
      setPendingId(pipelineId);
      setHistory(h => [{
        id: pipelineId, hash: txHash, amount, token,
        recipient: stealthAddress.slice(0,6) + "..." + stealthAddress.slice(-4),
        time: new Date().toLocaleTimeString("pt-BR"), done: false,
      }, ...h]);
      setStatus("Envio iniciado com sucesso.\nSeu destinatario recebera os fundos em ~8 min de forma completamente privada.");
      setAmount(""); setPayLink("");
    } catch (e) {
      setStatus(e.reason || e.message || "Erro desconhecido.");
      setStatusType("err");
    }
    setLoading(false);
  };

  // ── RECEIVE ───────────────────────────────────────────────────────────────
  const generateKeys = () => {
    const keys = generateStealthKeys();
    setMyKeys(keys);
    setDeposits([]);
  };

  const copyLink = () => {
    if (!myKeys) return;
    const link = buildPayLink(myKeys.metaAddress);
    navigator.clipboard.writeText(link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
  };

  // Export com senha
  const openExport = () => { setModal("export"); setModalPwd(""); setModalPwd2(""); setModalErr(""); };
  const openImport = () => { setModal("import"); setModalPwd(""); setModalErr(""); setModalFile(null); };
  const closeModal = () => { setModal(null); setModalPwd(""); setModalPwd2(""); setModalErr(""); setModalFile(null); };

  const doExport = async () => {
    if (!modalPwd) return setModalErr("Digite uma senha.");
    if (modalPwd !== modalPwd2) return setModalErr("As senhas nao coincidem.");
    if (modalPwd.length < 6) return setModalErr("Minimo 6 caracteres.");
    try {
      const encrypted = await encryptKeys(myKeys, modalPwd);
      const blob = new Blob([JSON.stringify(encrypted)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = "silentflow-backup.json"; a.click();
      URL.revokeObjectURL(url);
      closeModal();
    } catch (e) { setModalErr("Erro ao criptografar: " + e.message); }
  };

  const doImport = async () => {
    if (!modalFile) return setModalErr("Selecione o arquivo.");
    if (!modalPwd)  return setModalErr("Digite a senha.");
    try {
      const text    = await modalFile.text();
      const payload = JSON.parse(text);
      const keys    = await decryptKeys(payload, modalPwd);
      if (!keys.spendingPrivKey || !keys.viewingPrivKey || !keys.metaAddress)
        throw new Error("Arquivo invalido");
      setMyKeys(keys);
      setDeposits([]);
      closeModal();
    } catch (e) { setModalErr("Senha incorreta ou arquivo invalido."); }
  };

  const scan = useCallback(async () => {
    if (!myKeys || !account) return;
    setScanning(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
      const filter   = contract.filters.StealthDeposit();
      const currentBlock = await provider.getBlockNumber();
      const fromBlock    = Math.max(0, currentBlock - 50000);
      const CHUNK = 2000;
      const events = [];
      for (let start = fromBlock; start < currentBlock; start += CHUNK) {
        const end   = Math.min(start + CHUNK - 1, currentBlock);
        const chunk = await contract.queryFilter(filter, start, end);
        events.push(...chunk);
      }
      const found = [];
      for (const ev of events) {
        const ephemeralPubKey       = ev.args[0];
        const stealthAddressOnChain = ev.args[1];
        const tokenAddr             = ev.args[2];
        const viewTag               = Number(ev.args[4]);
        const result = tryDecryptDeposit(ephemeralPubKey, stealthAddressOnChain, viewTag, myKeys.spendingPrivKey, myKeys.viewingPrivKey);
        if (result) {
          const tokenAddrNorm = (!tokenAddr || tokenAddr === ethers.ZeroAddress) ? ethers.ZeroAddress : tokenAddr;
          const bal = await contract.balanceOf(stealthAddressOnChain, tokenAddrNorm);
          if (bal > 0n) {
            const tokenSymbol = tokenAddr === ethers.ZeroAddress ? "ETH"
              : Object.keys(TOKENS).find(k => TOKENS[k].address?.toLowerCase() === tokenAddr.toLowerCase()) || tokenAddr.slice(0,6);
            const decimals = tokenAddr === ethers.ZeroAddress ? 18 : (TOKENS[tokenSymbol]?.decimals || 18);
            found.push({ stealthAddress: stealthAddressOnChain, stealthPrivKey: result.stealthPrivKey, amount: ethers.formatUnits(bal, decimals), token: tokenSymbol, txHash: ev.transactionHash });
          }
        }
      }
      setDeposits(found);
    } catch (e) { alert("Erro ao escanear: " + e.message); }
    setScanning(false);
  }, [myKeys, account]);

  const withdraw = async (deposit) => {
    if (!account) return alert("Conecte sua carteira.");
    if (withdrawing) return;
    setWithdrawing(deposit.stealthAddress);
    try {
      const provider  = new ethers.BrowserProvider(window.ethereum);
      const signer    = await provider.getSigner();
      const contract  = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      const tokenAddr = TOKENS[deposit.token]?.address || ethers.ZeroAddress;
      const nonce     = await contract.withdrawNonces(deposit.stealthAddress);
      const chainId   = (await provider.getNetwork()).chainId;
      const dataHash  = ethers.solidityPackedKeccak256(
        ["address","address","address","uint256","uint256"],
        [deposit.stealthAddress, tokenAddr, account, nonce, chainId]
      );
      const stealthSigner = new ethers.Wallet(deposit.stealthPrivKey);
      const sig = await stealthSigner.signMessage(ethers.getBytes(dataHash));
      const tx  = await contract.withdrawFor(deposit.stealthAddress, tokenAddr, account, sig);
      await tx.wait();
      setDeposits(d => d.filter(x => x.stealthAddress !== deposit.stealthAddress));
      alert("Saque realizado com sucesso!");
    } catch (e) { alert("Erro ao sacar: " + (e.reason || e.message)); }
    setWithdrawing(null);
  };

  const fee = amount && !isNaN(parseFloat(amount))
    ? `${(parseFloat(amount) * 0.002).toFixed(6)} ${token}` : "—";

  const payLink_isValid = payLink && (payLink.startsWith("st:") || payLink.includes("/p/st:"));

  return (
    <>
      <div className="bg" />
      {/* BACKUP MODAL */}
      {modal && (
        <div className="modal-bg" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>✕</button>
            {modal === "export" ? (
              <>
                <div className="modal-title">Backup criptografado</div>
                <div className="modal-sub">Suas chaves serao criptografadas com sua senha antes de salvar. Use uma senha forte que voce nao vai esquecer.</div>
                <div className="fld">
                  <label>Senha</label>
                  <input type="password" placeholder="Minimo 6 caracteres" value={modalPwd} onChange={e => setModalPwd(e.target.value)} />
                </div>
                <div className="fld">
                  <label>Confirmar senha</label>
                  <input type="password" placeholder="Repita a senha" value={modalPwd2} onChange={e => setModalPwd2(e.target.value)} />
                </div>
                {modalErr && <div className="modal-err">{modalErr}</div>}
                <div className="modal-actions">
                  <button className="primary-btn" onClick={doExport}>Baixar backup</button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-title">Restaurar backup</div>
                <div className="modal-sub">Selecione o arquivo de backup e digite a senha usada na criacao.</div>
                <div className="fld">
                  <label>Arquivo de backup</label>
                  <input type="file" accept=".json" style={{fontFamily:"inherit",fontSize:"12px",color:"var(--text2)"}} onChange={e => setModalFile(e.target.files[0])} />
                </div>
                <div className="fld">
                  <label>Senha</label>
                  <input type="password" placeholder="Senha do backup" value={modalPwd} onChange={e => setModalPwd(e.target.value)} />
                </div>
                {modalErr && <div className="modal-err">{modalErr}</div>}
                <div className="modal-actions">
                  <button className="primary-btn" onClick={doImport}>Restaurar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="wrap">
        {/* HEADER */}
        <header className="hdr">
          <div className="logo">
            <img src="/logo.png" alt="SilentFlow" />
          </div>
          <div className="hdr-right">
            <div className="net-badge">SEPOLIA</div>
            <button className={`conn-btn${account ? " on" : ""}`} onClick={connect}>
              {account ? `● ${account.slice(0,6)}...${account.slice(-4)}` : "Conectar Carteira"}
            </button>
          </div>
        </header>

        {/* TABS */}
        <div className="tabs">
          <button className={`tab${tab==="send"?" on":""}`} onClick={() => setTab("send")}>↑ Enviar</button>
          <button className={`tab${tab==="receive"?" on":""}`} onClick={() => setTab("receive")}>↓ Receber</button>
        </div>

        {/* ── SEND TAB ── */}
        {tab === "send" && (
          <div className="grid">
            <div className="left">
              <span className="sec-label">Historico</span>
              <div className="card">
                <div className="card-body">
                  {history.length === 0
                    ? <div className="hist-empty">Nenhuma transacao ainda</div>
                    : history.map(tx => (
                      <div className="hist-item" key={tx.id}>
                        <div className="hist-row">
                          <span className="hist-amt">{tx.amount} {tx.token}</span>
                          <span className="hist-time">{tx.time}</span>
                        </div>
                        <div className="hist-to">→ {tx.recipient}</div>
                        <div className="hist-foot">
                          <span className={`pill ${tx.done?"done":"proc"}`}>{tx.done?"Entregue":"Processando"}</span>
                          <a className="hist-link" href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
              <div className="info-card">
                <div className="info-toggle" onClick={() => setAccordOpen(o => !o)}>
                  <span className="info-label">Como funciona a privacidade</span>
                  <span className={`info-arrow${accordOpen?" open":""}`}>▼</span>
                </div>
                <div className={`info-body${accordOpen?" open":""}`}>
                  {[
                    ["Entrada descartavel", "endereco novo por transacao"],
                    ["Stealth address",     "destinatario invisivel on-chain"],
                    ["Split automatico",    "2-3 partes aleatorias"],
                    ["Multi-hop real",      "2 carteiras efemeras por parte"],
                    ["Delays aleatorios",   "30s-2min por hop"],
                    ["Dummy noise",         "ruido entre hops"],
                    ["Taxa",                "0.2% por transacao"],
                  ].map(([k,v]) => (
                    <div className="info-row" key={k}>
                      <span className="info-k">{k}</span>
                      <span className="info-v">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* SEND FORM */}
            <div className="form-card">
              <div className="form-title">Enviar</div>
              <div className="form-sub">Cole o link de pagamento do destinatario</div>

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
                <label>Link de pagamento</label>
                <input
                  type="text"
                  placeholder="silentflow.vercel.app/p/st:... ou st:..."
                  value={payLink}
                  onChange={e => setPayLink(e.target.value)}
                  style={payLink_isValid ? {borderColor:"rgba(34,197,94,.3)"} : {}}
                />
              </div>

              <div className="sep" />
              <div className="fee-row">
                <span className="fee-l">Taxa de privacidade</span>
                <span className="fee-v">{fee}</span>
              </div>

              <button className="primary-btn" onClick={send} disabled={loading || !account}>
                {loading ? "Processando..." : "Enviar com privacidade"}
              </button>

              {status && (
                <div className={`status-box${statusType?" "+statusType:""}`}>
                  <pre>{status}</pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── RECEIVE TAB ── */}
        {tab === "receive" && (
          <div className="grid">
            <div className="left">
              <span className="sec-label">Fundos recebidos</span>
              <div className="card">
                <div className="card-body" style={{padding:"0 4px"}}>
                  {deposits.length === 0
                    ? <div className="hist-empty">
                        {scanning ? "Escaneando blockchain..." : "Nenhum deposito encontrado"}
                      </div>
                    : deposits.map(d => (
                      <div className="deposit-item" key={d.stealthAddress}>
                        <div className="deposit-header">
                          <span className="deposit-amt">{d.amount}</span>
                          <span className="deposit-token">{d.token}</span>
                        </div>
                        <div className="deposit-addr">{d.stealthAddress.slice(0,10)}...{d.stealthAddress.slice(-8)}</div>
                        <button className="primary-btn" style={{padding:"10px",fontSize:"13px"}} onClick={() => withdraw(d)} disabled={withdrawing === d.stealthAddress}>
                          {withdrawing === d.stealthAddress ? "Sacando..." : "Sacar para minha carteira"}
                        </button>
                      </div>
                    ))
                  }
                </div>
              </div>
              <div className="warning-box">
                <p>⚠️ Suas chaves ficam salvas neste navegador. Use o backup com senha para nao perder o acesso se trocar de dispositivo.</p>
              </div>
            </div>

            {/* RECEIVE FORM */}
            <div className="form-card">
              <div className="form-title">Receber</div>
              <div className="form-sub">Compartilhe seu link — seu endereco real nunca aparece on-chain</div>

              {!myKeys ? (
                <>
                  <div className="no-keys">
                    <div className="no-keys-icon">🔑</div>
                    <div className="no-keys-title">Crie seu link de pagamento</div>
                    <div className="no-keys-sub">Gere suas chaves uma vez e compartilhe o link com quem quiser te enviar fundos.</div>
                  </div>
                  <button className="primary-btn" onClick={generateKeys}>
                    Gerar link de pagamento
                  </button>
                  <button className="ghost-btn" onClick={openImport}>
                    Restaurar backup
                  </button>
                </>
              ) : (
                <>
                  <div className="link-box">
                    <div className="link-box-label">Seu link de pagamento</div>
                    <div className="link-url" onClick={copyLink}>
                      {buildPayLink(myKeys.metaAddress)}
                    </div>
                    <div className="link-actions">
                      <button className={`link-btn${linkCopied?" link-copied":""}`} onClick={copyLink}>
                        {linkCopied ? "✓ Copiado!" : "Copiar link"}
                      </button>
                    </div>
                  </div>

                  <div className="sep" />

                  <button className="primary-btn" onClick={scan} disabled={scanning || !account}>
                    {scanning ? "Escaneando..." : "Verificar fundos recebidos"}
                  </button>
                  <button className="ghost-btn" onClick={openExport}>
                    Backup com senha
                  </button>
                  <button className="ghost-btn danger-btn" onClick={generateKeys} style={{marginTop:"6px"}}>
                    Gerar novo link
                  </button>

                  {status && (
                    <div className={`status-box${statusType?" "+statusType:""}`}>
                      <pre>{status}</pre>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* FOOTER */}
        <footer className="footer">
          <span className="footer-l">SILENTFLOW</span>
          <div className="footer-r">
            <a className="footer-link" href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Contrato ↗</a>
            <a className="footer-link" href="https://silentflow-landing-wine.vercel.app" target="_blank" rel="noreferrer">Pagina inicial ↗</a>
          </div>
        </footer>
      </div>
    </>
  );
}
