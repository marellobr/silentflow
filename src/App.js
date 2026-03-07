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

// ── Stealth crypto helpers ────────────────────────────────────────────────────

// Generate a stealth meta-address: spendingKey + viewingKey
function generateStealthKeys() {
  const spendingWallet = ethers.Wallet.createRandom();
  const viewingWallet  = ethers.Wallet.createRandom();
  return {
    spendingPrivKey: spendingWallet.privateKey,
    spendingPubKey:  ethers.SigningKey.computePublicKey(spendingWallet.privateKey, true),
    viewingPrivKey:  viewingWallet.privateKey,
    viewingPubKey:   ethers.SigningKey.computePublicKey(viewingWallet.privateKey, true),
    // Meta-address = spendingPubKey:viewingPubKey (hex, separated by :)
    metaAddress: `st:${ethers.SigningKey.computePublicKey(spendingWallet.privateKey, true)}:${ethers.SigningKey.computePublicKey(viewingWallet.privateKey, true)}`,
  };
}

// ── Stealth Crypto (simple, consistent, hash-based) ─────────────────────────
//
// SEND side (knows ephemeralPrivKey, spendingPubKey, viewingPubKey):
//   h = keccak256(ephemeralPrivKey || viewingPubKey)   <- uses privKey for ECDH-like scalar
//   stealthPrivKey = (spendingPrivKey + h) mod n        <- receiver will compute this
//   stealthAddress = address(stealthPrivKey * G)        <- sender derives address same way:
//                  = address from keccak256(h || spendingPubKey) as a wallet seed
//
// But sender doesn't have spendingPrivKey. So we use a SYMMETRIC approach:
//   h = keccak256(ephemeralPubKey || viewingPubKey)     <- both sides can compute
//   stealthSeed = keccak256(h || spendingPubKey)        <- deterministic seed
//   stealthPrivKey = stealthSeed                        <- treat seed as private key
//   stealthAddress = new ethers.Wallet(stealthSeed).address
//
// RECEIVE side (knows viewingPrivKey, spendingPrivKey):
//   viewingPubKey = computePublicKey(viewingPrivKey)
//   h = keccak256(ephemeralPubKey || viewingPubKey)     <- same as sender
//   stealthSeed = keccak256(h || spendingPubKey)        <- same as sender
//   stealthPrivKey = stealthSeed
//   stealthAddress = new ethers.Wallet(stealthSeed).address  <- must match on-chain
//
// This is FULLY CONSISTENT because both sides compute the same h and seed.

function deriveStealthAddress(metaAddress) {
  const parts = metaAddress.replace("st:", "").split(":");
  if (parts.length !== 2) throw new Error("Stealth meta-address inválida");
  const [spendingPubKey, viewingPubKey] = parts;

  const ephemeralWallet = ethers.Wallet.createRandom();
  const ephemeralPubKey = ethers.SigningKey.computePublicKey(ephemeralWallet.privateKey, true);

  const h = ethers.keccak256(
    ethers.concat([ethers.getBytes(ephemeralPubKey), ethers.getBytes(viewingPubKey)])
  );
  const stealthSeed = ethers.keccak256(
    ethers.concat([ethers.getBytes(h), ethers.getBytes(spendingPubKey)])
  );
  const stealthAddress = new ethers.Wallet(stealthSeed).address;
  const viewTag = parseInt(h.slice(2, 4), 16);

  return { stealthAddress, ephemeralPubKey, viewTag };
}

function tryDecryptDeposit(ephemeralPubKeyHex, stealthAddressOnChain, viewTagOnChain, spendingPrivKey, viewingPrivKey) {
  try {
    if (viewTagOnChain === 0) return null;

    const viewingPubKey  = ethers.SigningKey.computePublicKey(viewingPrivKey, true);
    const spendingPubKey = ethers.SigningKey.computePublicKey(spendingPrivKey, true);

    const h = ethers.keccak256(
      ethers.concat([ethers.getBytes(ephemeralPubKeyHex), ethers.getBytes(viewingPubKey)])
    );

    // Fast reject via viewTag
    if (parseInt(h.slice(2, 4), 16) !== viewTagOnChain) return null;

    const stealthSeed = ethers.keccak256(
      ethers.concat([ethers.getBytes(h), ethers.getBytes(spendingPubKey)])
    );
    const stealthWallet = new ethers.Wallet(stealthSeed);

    if (stealthWallet.address.toLowerCase() !== stealthAddressOnChain.toLowerCase()) return null;

    return { stealthAddress: stealthWallet.address, stealthPrivKey: stealthSeed };
  } catch {
    return null;
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Mono:wght@300;400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:#04060e;color:#d8dce8;font-family:'DM Mono',monospace;min-height:100vh}

.bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.bg::before{content:'';position:absolute;width:1000px;height:600px;top:-280px;left:50%;transform:translateX(-50%);background:radial-gradient(ellipse,rgba(30,144,255,.06) 0%,transparent 65%);border-radius:50%}
.bg::after{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:55%;height:1px;background:linear-gradient(90deg,transparent,rgba(30,144,255,.28),transparent)}

.wrap{position:relative;z-index:1;max-width:1020px;margin:0 auto;padding:0 28px 80px}

/* HEADER */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:26px 0;border-bottom:1px solid rgba(255,255,255,.04);margin-bottom:40px}
.logo{display:flex;align-items:center;gap:12px}
.logo img{height:48px;width:auto;object-fit:contain;filter:drop-shadow(0 0 14px rgba(30,144,255,.4))}
.hdr-right{display:flex;align-items:center;gap:10px}
.net-dot{display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px;font-size:11px;color:rgba(255,255,255,.3);letter-spacing:.5px}
.net-dot::before{content:'';width:7px;height:7px;border-radius:50%;background:#00dc64;box-shadow:0 0 6px #00dc64;animation:pulse 2s ease-in-out infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.conn-btn{padding:9px 18px;background:transparent;border:1px solid rgba(255,255,255,.1);border-radius:9px;color:rgba(255,255,255,.4);font-family:'DM Mono',monospace;font-size:13px;cursor:pointer;transition:all .2s}
.conn-btn:hover{border-color:rgba(255,255,255,.2);color:rgba(255,255,255,.7)}
.conn-btn.on{border-color:rgba(0,220,100,.22);color:#00dc64;background:rgba(0,220,100,.05)}

/* TABS */
.tabs{display:flex;gap:4px;margin-bottom:32px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:12px;padding:4px}
.tab{flex:1;padding:11px;background:transparent;border:none;border-radius:9px;color:rgba(255,255,255,.3);font-family:'DM Mono',monospace;font-size:13px;cursor:pointer;transition:all .2s;letter-spacing:.3px}
.tab:hover{color:rgba(255,255,255,.6)}
.tab.on{background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.08)}

/* GRID */
.grid{display:grid;grid-template-columns:1fr 368px;gap:24px;align-items:start}

/* LEFT PANELS */
.left{display:flex;flex-direction:column;gap:18px}
.sec-label{font-family:'Syne',sans-serif;font-size:11px;font-weight:600;color:rgba(255,255,255,.22);letter-spacing:2px;text-transform:uppercase}

.card{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:16px;overflow:hidden}
.card-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.04)}
.card-title{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:rgba(255,255,255,.28);letter-spacing:2px;text-transform:uppercase}
.card-body{padding:6px 0}

.hist-empty{text-align:center;padding:28px 0;color:rgba(255,255,255,.14);font-size:13px}
.hist-item{padding:13px 20px;border-bottom:1px solid rgba(255,255,255,.03);transition:background .15s}
.hist-item:hover{background:rgba(255,255,255,.015)}
.hist-item:last-child{border-bottom:none}
.hist-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.hist-amt{font-size:15px;font-weight:500;color:#d8dce8}
.hist-time{font-size:11px;color:rgba(255,255,255,.18)}
.hist-to{font-size:12px;color:rgba(255,255,255,.28);margin-bottom:7px}
.hist-foot{display:flex;align-items:center;justify-content:space-between}
.pill{font-size:11px;padding:2px 10px;border-radius:20px}
.pill.done{background:rgba(0,220,100,.06);border:1px solid rgba(0,220,100,.15);color:#00dc64}
.pill.proc{background:rgba(30,144,255,.06);border:1px solid rgba(30,144,255,.15);color:#4da6ff}
.hist-link{font-size:11px;color:rgba(255,255,255,.2);text-decoration:none;transition:color .2s}
.hist-link:hover{color:rgba(255,255,255,.5)}

/* ACCORDION */
.accord{background:rgba(255,255,255,.015);border:1px solid rgba(255,255,255,.05);border-radius:14px;overflow:hidden}
.accord-toggle{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;cursor:pointer;user-select:none;transition:background .15s}
.accord-toggle:hover{background:rgba(255,255,255,.02)}
.accord-label{font-size:12px;color:rgba(255,255,255,.26)}
.accord-arrow{font-size:10px;color:rgba(255,255,255,.16);transition:transform .25s}
.accord-arrow.open{transform:rotate(180deg)}
.accord-body{max-height:0;overflow:hidden;transition:max-height .3s ease,opacity .3s;opacity:0}
.accord-body.open{max-height:300px;opacity:1}
.accord-row{display:flex;justify-content:space-between;padding:10px 18px;border-top:1px solid rgba(255,255,255,.03)}
.accord-k{font-size:12px;color:rgba(255,255,255,.26)}
.accord-v{font-size:12px;color:rgba(255,255,255,.42)}

/* FORM CARD */
.form-card{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:26px;position:sticky;top:24px}
.form-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:#fff;margin-bottom:2px;letter-spacing:-.3px}
.form-sub{font-size:11px;color:rgba(255,255,255,.22);margin-bottom:22px}

.toks{display:flex;gap:6px;margin-bottom:18px}
.tok{flex:1;padding:9px 0;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;color:rgba(255,255,255,.32);font-family:'DM Mono',monospace;font-size:13px;cursor:pointer;transition:all .2s}
.tok:hover{border-color:rgba(255,255,255,.14);color:rgba(255,255,255,.6)}
.tok.on{background:rgba(30,144,255,.1);border-color:rgba(30,144,255,.32);color:#4da6ff}

.fld{margin-bottom:14px}
.fld label{display:block;font-size:10px;color:rgba(255,255,255,.24);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:7px}
.fld input,.fld textarea{width:100%;padding:12px 13px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:10px;color:#fff;font-family:'DM Mono',monospace;font-size:13px;outline:none;transition:all .2s;resize:none}
.fld input:focus,.fld textarea:focus{border-color:rgba(30,144,255,.32);background:rgba(30,144,255,.04)}
.fld input::placeholder,.fld textarea::placeholder{color:rgba(255,255,255,.14)}

.sep{height:1px;background:rgba(255,255,255,.05);margin:16px 0}

.fee-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.fee-l{font-size:12px;color:rgba(255,255,255,.22)}
.fee-v{font-size:12px;color:rgba(255,255,255,.36)}

.primary-btn{width:100%;padding:14px;background:linear-gradient(135deg,#1a7fe8,#0050b3);border:none;border-radius:11px;color:#fff;font-family:'Syne',sans-serif;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s;letter-spacing:.2px;box-shadow:0 2px 18px rgba(30,144,255,.16)}
.primary-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 5px 28px rgba(30,144,255,.28)}
.primary-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}

.ghost-btn{width:100%;padding:12px;background:transparent;border:1px solid rgba(255,255,255,.1);border-radius:11px;color:rgba(255,255,255,.45);font-family:'DM Mono',monospace;font-size:13px;cursor:pointer;transition:all .2s;margin-top:8px}
.ghost-btn:hover{border-color:rgba(255,255,255,.2);color:rgba(255,255,255,.7)}

.status-box{margin-top:13px;padding:12px 13px;border-radius:10px;background:rgba(30,144,255,.05);border:1px solid rgba(30,144,255,.13)}
.status-box pre{font-family:'DM Mono',monospace;font-size:12px;color:#4da6ff;white-space:pre-wrap;margin:0;line-height:1.6}
.status-box.ok{background:rgba(0,220,100,.05);border-color:rgba(0,220,100,.13)}
.status-box.ok pre{color:#00dc64}
.status-box.err{background:rgba(255,90,90,.05);border-color:rgba(255,90,90,.13)}
.status-box.err pre{color:#ff7070}

/* RECEIVE TAB */
.key-box{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px;margin-bottom:14px;word-break:break-all;font-size:11px;color:rgba(255,255,255,.5);line-height:1.7}
.key-label{font-size:10px;color:rgba(255,255,255,.25);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px}
.key-value{color:#4da6ff;font-size:11px;cursor:pointer;transition:color .2s}
.key-value:hover{color:#1E90FF}
.copy-hint{font-size:10px;color:rgba(255,255,255,.2);margin-top:4px}

.deposit-item{padding:14px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.deposit-item:last-child{border-bottom:none}
.deposit-amt{font-size:16px;font-weight:500;color:#00dc64;margin-bottom:4px}
.deposit-addr{font-size:11px;color:rgba(255,255,255,.3);margin-bottom:8px}

.warning-box{background:rgba(255,180,30,.05);border:1px solid rgba(255,180,30,.15);border-radius:10px;padding:12px 14px;margin-bottom:14px}
.warning-box p{font-size:11px;color:rgba(255,180,30,.8);line-height:1.6}

/* FOOTER */
.footer{margin-top:56px;padding-top:22px;border-top:1px solid rgba(255,255,255,.04);display:flex;justify-content:space-between;align-items:center}
.footer-l{font-family:'Syne',sans-serif;font-size:14px;font-weight:800;color:#1E90FF;letter-spacing:1px}
.footer-r{display:flex;gap:18px}
.footer-link{font-size:11px;color:rgba(255,255,255,.2);text-decoration:none;transition:color .2s}
.footer-link:hover{color:rgba(255,255,255,.5)}

@media(max-width:760px){
  .grid{grid-template-columns:1fr}
  .form-card{position:static}
  .hdr{padding:18px 0;margin-bottom:28px}
}
`;

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [account, setAccount]       = useState(null);
  const [tab, setTab]               = useState("send"); // "send" | "receive"

  // Send state
  const [amount, setAmount]         = useState("");
  const [metaAddr, setMetaAddr]     = useState("");
  const [token, setToken]           = useState("ETH");
  const [status, setStatus]         = useState("");
  const [statusType, setStatusType] = useState("");
  const [loading, setLoading]       = useState(false);
  const [history, setHistory]       = useState([]);
  const [pendingId, setPendingId]   = useState(null);
  const [accordOpen, setAccordOpen] = useState(false);

  // Receive state
  const [myKeys, setMyKeys]         = useState(null); // { spendingPrivKey, viewingPrivKey, metaAddress }
  const [scanning, setScanning]     = useState(false);
  const [deposits, setDeposits]     = useState([]);
  const [withdrawing, setWithdrawing] = useState(null);
  const [copied, setCopied]         = useState(false);

  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = STYLE;
    document.head.appendChild(s);
    return () => document.head.removeChild(s);
  }, []);

  // Poll status
  useEffect(() => {
    if (!pendingId) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/status/${pendingId}`);
        const d = await r.json();
        if (d.concluido) {
          setStatus("Transação entregue com sucesso.");
          setStatusType("ok");
          clearInterval(iv); setPendingId(null);
          setHistory(h => h.map(t => t.id === pendingId ? { ...t, done: true } : t));
        } else {
          setStatus(`Processando... ${d.hopsFeitos}/${d.hopsTotal} etapas · ~${d.minutosRestantes} min`);
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

  // ── SEND ──────────────────────────────────────────────────────────────────
  const send = async () => {
    if (!account)            return alert("Conecte sua carteira.");
    if (!amount || !metaAddr) return alert("Preencha todos os campos.");
    setLoading(true); setStatus("Derivando stealth address..."); setStatusType("");
    try {
      const { stealthAddress, ephemeralPubKey, viewTag } = deriveStealthAddress(metaAddr);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      let txHash;

      if (token === "ETH") {
        const tx = await contract.depositETH(stealthAddress, ephemeralPubKey, viewTag, { value: ethers.parseEther(amount) });
        await tx.wait(); txHash = tx.hash;
      } else {
        const t = TOKENS[token];
        const tc = new ethers.Contract(t.address, ERC20_ABI, signer);
        const val = ethers.parseUnits(amount, t.decimals);
        const allow = await tc.allowance(account, CONTRACT_ADDRESS);
        if (allow < val) { const a = await tc.approve(CONTRACT_ADDRESS, val); await a.wait(); }
        const tx = await contract.depositToken(t.address, val, stealthAddress, ephemeralPubKey, viewTag);
        await tx.wait(); txHash = tx.hash;
      }

      const res  = await fetch(`${BACKEND_URL}/agendar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash, destinatario: stealthAddress, valor: amount, token }),
      });
      const data = await res.json();
      setPendingId(data.id);

      setHistory(h => [{
        id: data.id, hash: txHash, amount, token,
        recipient: stealthAddress.slice(0,6) + "..." + stealthAddress.slice(-4),
        time: new Date().toLocaleTimeString("pt-BR"), done: false,
      }, ...h]);

      setStatus(`Enviando ${amount} ${token}.\nStealth address derivado — destinatário invisível on-chain.\nEstimativa: ~${data.estimativaMinutos} min`);
      setAmount(""); setMetaAddr("");
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

  const loadKeysFromStorage = () => {
    const saved = localStorage.getItem("sf_keys");
    if (saved) { setMyKeys(JSON.parse(saved)); setDeposits([]); }
    else alert("Nenhuma chave salva neste navegador.");
  };

  const exportKeys = () => {
    if (!myKeys) return;
    const blob = new Blob([JSON.stringify(myKeys, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "silentflow-keys.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const importKeys = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const keys = JSON.parse(ev.target.result);
        if (!keys.spendingPrivKey || !keys.viewingPrivKey || !keys.metaAddress)
          throw new Error("Arquivo inválido");
        setMyKeys(keys);
        setDeposits([]);
      } catch { alert("Arquivo de chaves inválido."); }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (myKeys) localStorage.setItem("sf_keys", JSON.stringify(myKeys));
  }, [myKeys]);

  const copyMeta = () => {
    if (!myKeys) return;
    navigator.clipboard.writeText(myKeys.metaAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const scan = useCallback(async () => {
    if (!myKeys || !account) return;
    setScanning(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
      const filter   = contract.filters.StealthDeposit();
      // Get current block and scan last 50000 blocks in chunks to avoid RPC limits
      const currentBlock = await provider.getBlockNumber();
      const fromBlock    = Math.max(0, currentBlock - 50000);
      const CHUNK        = 2000;
      const events       = [];
      for (let start = fromBlock; start < currentBlock; start += CHUNK) {
        const end    = Math.min(start + CHUNK - 1, currentBlock);
        const chunk  = await contract.queryFilter(filter, start, end);
        events.push(...chunk);
      }

      const found = [];
      for (const ev of events) {
        const ephemeralPubKey    = ev.args[0];
        const stealthAddressOnChain = ev.args[1];
        const tokenAddr          = ev.args[2];

        const viewTag            = Number(ev.args[4]);

        const result = tryDecryptDeposit(
          ephemeralPubKey, stealthAddressOnChain, viewTag,
          myKeys.spendingPrivKey, myKeys.viewingPrivKey
        );

        if (result) {
          // Check if still has balance
          const tokenAddrNorm = (!tokenAddr || tokenAddr === ethers.ZeroAddress || tokenAddr === "0x0000000000000000000000000000000000000000")
            ? ethers.ZeroAddress : tokenAddr;
          const bal = await contract.balanceOf(stealthAddressOnChain, tokenAddrNorm);
          if (bal > 0n) {
            const tokenSymbol = tokenAddr === ethers.ZeroAddress ? "ETH"
              : Object.keys(TOKENS).find(k => TOKENS[k].address?.toLowerCase() === tokenAddr.toLowerCase()) || tokenAddr.slice(0,6);
            const decimals = tokenAddr === ethers.ZeroAddress ? 18
              : (TOKENS[tokenSymbol]?.decimals || 18);
            found.push({
              stealthAddress: stealthAddressOnChain,
              stealthPrivKey: result.stealthPrivKey,
              amount: ethers.formatUnits(bal, decimals),
              token: tokenSymbol,
              txHash: ev.transactionHash,
            });
          }
        }
      }
      setDeposits(found);
    } catch (e) {
      alert("Erro ao escanear: " + e.message);
    }
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

      // Gasless withdraw: stealthSigner signs, connected wallet pays gas
      const nonce   = await contract.withdrawNonces(deposit.stealthAddress);
      const chainId = (await provider.getNetwork()).chainId;

      // Must match contract: keccak256(abi.encodePacked(stealthAddress, token, recipient, nonce, chainId))
      const dataHash = ethers.solidityPackedKeccak256(
        ["address","address","address","uint256","uint256"],
        [deposit.stealthAddress, tokenAddr, account, nonce, chainId]
      );

      // stealthSigner.signMessage adds the "\x19Ethereum Signed Message:\n32" prefix — matches contract
      const stealthSigner = new ethers.Wallet(deposit.stealthPrivKey);
      const sig = await stealthSigner.signMessage(ethers.getBytes(dataHash));

      const tx = await contract.withdrawFor(deposit.stealthAddress, tokenAddr, account, sig);
      await tx.wait();

      setDeposits(d => d.filter(x => x.stealthAddress !== deposit.stealthAddress));
      alert("Saque realizado com sucesso!");
    } catch (e) {
      alert("Erro ao sacar: " + (e.reason || e.message));
    }
    setWithdrawing(null);
  };

  const fee = amount && !isNaN(parseFloat(amount))
    ? `${(parseFloat(amount) * 0.002).toFixed(6)} ${token}` : "—";

  return (
    <>
      <div className="bg" />
      <div className="wrap">

        {/* HEADER */}
        <header className="hdr">
          <div className="logo">
            <img src="/logo.png" alt="SilentFlow" />
          </div>
          <div className="hdr-right">
            <div className="net-dot">SEPOLIA</div>
            <button className={`conn-btn${account ? " on" : ""}`} onClick={connect}>
              {account ? `● ${account.slice(0,6)}...${account.slice(-4)}` : "Conectar Carteira"}
            </button>
          </div>
        </header>

        {/* TABS */}
        <div className="tabs">
          <button className={`tab${tab==="send"?" on":""}`} onClick={() => setTab("send")}>
            Enviar
          </button>
          <button className={`tab${tab==="receive"?" on":""}`} onClick={() => setTab("receive")}>
            Receber
          </button>
        </div>

        {/* ── SEND TAB ── */}
        {tab === "send" && (
          <div className="grid">
            <div className="left">
              <span className="sec-label">Histórico</span>
              <div className="card">
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
                          <span className={`pill ${tx.done?"done":"proc"}`}>{tx.done?"Entregue":"Processando"}</span>
                          <a className="hist-link" href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>

              <div className="accord">
                <div className="accord-toggle" onClick={() => setAccordOpen(o => !o)}>
                  <span className="accord-label">Como funciona a privacidade</span>
                  <span className={`accord-arrow${accordOpen?" open":""}`}>▼</span>
                </div>
                <div className={`accord-body${accordOpen?" open":""}`}>
                  {[
                    ["Stealth address",    "destinatário invisível on-chain"],
                    ["Split automático",   "2–4 partes aleatórias"],
                    ["Multi-hop",          "2–3 endereços efêmeros por parte"],
                    ["Delay",              "30s–3 min por hop"],
                    ["Dummy transactions", "ruído entre hops"],
                    ["Taxa",               "0.2% por transação"],
                  ].map(([k,v]) => (
                    <div className="accord-row" key={k}>
                      <span className="accord-k">{k}</span>
                      <span className="accord-v">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* SEND FORM */}
            <div className="form-card">
              <div className="form-title">Envio Privado</div>
              <div className="form-sub">Stealth address · non-custodial · 0.2% de taxa</div>

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
                <label>Stealth Meta-Address do Destinatário</label>
                <textarea rows={3} placeholder="st:02abc...def:03ghi...jkl" value={metaAddr} onChange={e => setMetaAddr(e.target.value)} />
              </div>

              <div className="sep" />
              <div className="fee-row">
                <span className="fee-l">Taxa de privacidade</span>
                <span className="fee-v">{fee}</span>
              </div>

              <button className="primary-btn" onClick={send} disabled={loading || !account}>
                {loading ? "Processando..." : "Enviar"}
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
              <span className="sec-label">Depósitos Detectados</span>
              <div className="card">
                <div className="card-body" style={{padding:"0 4px"}}>
                  {deposits.length === 0
                    ? <div className="hist-empty">
                        {scanning ? "Escaneando blockchain..." : "Nenhum depósito encontrado"}
                      </div>
                    : deposits.map(d => (
                      <div className="deposit-item" key={d.stealthAddress} style={{padding:"14px 18px"}}>
                        <div className="deposit-amt">{d.amount} {d.token}</div>
                        <div className="deposit-addr">{d.stealthAddress}</div>
                        <button
                          className="primary-btn"
                          style={{padding:"9px",fontSize:"13px"}}
                          onClick={() => withdraw(d)}
                          disabled={withdrawing === d.stealthAddress}
                        >
                          {withdrawing === d.stealthAddress ? "Sacando..." : "Sacar para minha carteira"}
                        </button>
                      </div>
                    ))
                  }
                </div>
              </div>

              <div className="warning-box">
                <p>⚠️ Guarde suas chaves em local seguro. Sem elas não é possível recuperar os fundos. Elas ficam salvas apenas neste navegador.</p>
              </div>
            </div>

            {/* RECEIVE FORM */}
            <div className="form-card">
              <div className="form-title">Receber com Privacidade</div>
              <div className="form-sub">Seu endereço real nunca aparece on-chain</div>

              {!myKeys ? (
                <>
                  <button className="primary-btn" onClick={generateKeys}>
                    Gerar minhas chaves de privacidade
                  </button>
                  <button className="ghost-btn" onClick={loadKeysFromStorage}>
                    Recuperar chaves do navegador
                  </button>
                  <label className="ghost-btn" style={{display:"block",textAlign:"center",cursor:"pointer",marginTop:"8px"}}>
                    Importar arquivo de chaves (.json)
                    <input type="file" accept=".json" style={{display:"none"}} onChange={importKeys} />
                  </label>
                </>
              ) : (
                <>
                  <div className="fld">
                    <div className="key-label">Sua Stealth Meta-Address</div>
                    <div className="key-box">
                      <div className="key-label">Compartilhe com quem vai te enviar fundos:</div>
                      <div className="key-value" onClick={copyMeta}>
                        {myKeys.metaAddress}
                      </div>
                      <div className="copy-hint">{copied ? "✓ Copiado!" : "Clique para copiar"}</div>
                    </div>
                  </div>

                  <div className="sep" />

                  <button className="primary-btn" onClick={scan} disabled={scanning || !account}>
                    {scanning ? "Escaneando..." : "Escanear blockchain"}
                  </button>
                  <button className="ghost-btn" onClick={exportKeys}>
                    Baixar backup das chaves (.json)
                  </button>
                  <button className="ghost-btn" onClick={generateKeys} style={{marginTop:"6px",color:"rgba(255,100,100,.5)",borderColor:"rgba(255,100,100,.15)"}}>
                    Gerar novas chaves
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
            <a className="footer-link" href="https://silentflow-landing-wine.vercel.app" target="_blank" rel="noreferrer">Landing page ↗</a>
          </div>
        </footer>

      </div>
    </>
  );
}
