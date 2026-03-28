/* eslint-disable no-undef */
import { useState, useEffect } from "react";
import { ethers } from "ethers";

const CONTRACT_ADDRESS = "0x99f4a6Deb7643a1DDa10115BFE3c7a4D9C4Ef09B";
const BACKEND_URL      = "https://silentflow-production.up.railway.app";
const BASE_CHAIN_ID    = 8453;

const ABI = [
  "function depositETH(address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external payable",
  "function depositETHTimelocked(address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external payable",
  "function depositToken(address token, uint256 amount, address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external",
  "function depositTokenTimelocked(address token, uint256 amount, address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external",
  "function withdrawFor(address stealthAddress, address token, address recipient, bytes calldata sig) external",
  "function balanceOf(address stealthAddress, address token) external view returns (uint256)",
  "function getUnlockTime(address stealthAddress, address token) external view returns (uint256)",
  "function isUnlocked(address stealthAddress, address token) external view returns (bool)",
  "function isValidDenomination(address token, uint256 amount) external view returns (bool)",
  "event StealthDeposit(bytes ephemeralPubKey, address indexed stealthAddress, address token, uint256 amount, uint8 viewTag, bool timelocked, uint256 unlockAt)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];

const TOKENS = {
  ETH:  { address: "0x0000000000000000000000000000000000000000", decimals: 18, symbol: "ETH" },
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  symbol: "USDC" },
  USDT: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6,  symbol: "USDT" }
};

const DENOMS = {
  ETH:  [0.01, 0.05, 0.1, 0.5, 1, 5],
  USDC: [10, 50, 100, 500, 1000],
  USDT: [10, 50, 100, 500, 1000]
};

function getTierInfo(amountUsd) {
  if (amountUsd >= 5000) return { label: "Premium", bps: 10, color: "#a78bfa" };
  if (amountUsd >= 500)  return { label: "Volume",  bps: 15, color: "#34d399" };
  return                        { label: "Standard", bps: 20, color: "#22b8e6" };
}

function tryDecryptDeposit(ephemeralPubKeyHex, stealthAddressOnChain, viewTagOnChain, spendingPrivKey, viewingPrivKey) {
  try {
    const viewingPubKey  = ethers.SigningKey.computePublicKey(viewingPrivKey, true);
    const spendingPubKey = ethers.SigningKey.computePublicKey(spendingPrivKey, true);
    const h = ethers.keccak256(ethers.concat([
      ethers.getBytes(ephemeralPubKeyHex),
      ethers.getBytes(viewingPubKey)
    ]));
    if (parseInt(h.slice(2, 4), 16) !== viewTagOnChain) return null;
    const stealthSeed = ethers.keccak256(ethers.concat([
      ethers.getBytes(h),
      ethers.getBytes(spendingPubKey)
    ]));
    const stealthWallet = new ethers.Wallet(stealthSeed);
    if (stealthWallet.address.toLowerCase() !== stealthAddressOnChain.toLowerCase()) return null;
    return { stealthAddress: stealthWallet.address, stealthPrivKey: stealthSeed };
  } catch { return null; }
}

async function encryptKeys(data, password) {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMat, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data)));
  return btoa(JSON.stringify({
    salt: Array.from(salt), iv: Array.from(iv), ct: Array.from(new Uint8Array(ct))
  }));
}

async function decryptKeys(b64, password) {
  const enc = new TextEncoder();
  const { salt, iv, ct } = JSON.parse(atob(b64));
  const keyMat = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations: 100000, hash: "SHA-256" },
    keyMat, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, new Uint8Array(ct));
  return JSON.parse(new TextDecoder().decode(dec));
}

const S = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#09090b;--surface:#0f0f14;--surface2:#141420;
  --border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.12);
  --accent:#22b8e6;--accent2:#38d0ff;--accent-dim:rgba(34,184,230,0.12);
  --green:#34d399;--amber:#fbbf24;--red:#f87171;--purple:#a78bfa;
  --text:#e2e8f0;--muted:#64748b;--muted2:#94a3b8;
  --sans:'DM Sans',sans-serif;--mono:'JetBrains Mono',monospace;
  --r:12px;--r2:8px;
}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.6;min-height:100vh}
button{cursor:pointer;font-family:var(--sans)}
input,textarea{font-family:var(--sans)}
a{color:var(--accent);text-decoration:none}
.app{min-height:100vh;display:flex;flex-direction:column}
.nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:rgba(9,9,11,0.85);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.nav-left{display:flex;align-items:center;gap:14px}
.nav-logo{display:flex;align-items:center;gap:10px}
.nav-logo img{width:28px;height:28px;filter:drop-shadow(0 0 8px rgba(34,184,230,0.6))}
.nav-logo span{font-size:15px;font-weight:600;letter-spacing:0.04em;color:#fff}
.net-badge{font-family:var(--mono);font-size:10px;color:var(--green);background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.25);padding:3px 10px;border-radius:20px;letter-spacing:0.05em}
.nav-right{display:flex;align-items:center;gap:12px}
.lang-btn{background:transparent;border:1px solid var(--border2);color:var(--muted2);font-size:12px;padding:5px 12px;border-radius:20px;transition:all 0.2s}
.lang-btn:hover{border-color:var(--accent);color:var(--accent)}
.connect-btn{background:var(--accent);color:var(--bg);font-weight:600;font-size:13px;padding:8px 18px;border-radius:var(--r2);border:none;transition:all 0.2s;box-shadow:0 0 16px rgba(34,184,230,0.2)}
.connect-btn:hover{opacity:0.85;transform:translateY(-1px)}
.account-pill{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border2);padding:7px 14px;border-radius:20px;font-family:var(--mono);font-size:12px;color:var(--accent2)}
.account-dot{width:7px;height:7px;border-radius:50%;background:var(--green)}
.main{flex:1;max-width:1080px;margin:0 auto;width:100%;padding:32px 20px}
.tabs{display:flex;gap:4px;margin-bottom:28px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:4px}
.tab{flex:1;padding:9px 0;border:none;border-radius:var(--r2);background:transparent;color:var(--muted);font-size:13px;font-weight:500;transition:all 0.2s}
.tab:hover{color:var(--text)}
.tab.active{background:var(--surface2);color:var(--accent);border:1px solid var(--border2)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:24px}
.card-title{font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:20px}
.form-group{margin-bottom:16px}
.form-label{font-size:12px;color:var(--muted);margin-bottom:6px;display:block;font-weight:500}
.form-input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2);padding:10px 14px;color:var(--text);font-size:14px;transition:border-color 0.2s;outline:none}
.form-input:focus{border-color:var(--accent)}
.form-input::placeholder{color:var(--muted)}
.form-sub{font-size:12px;color:var(--muted);margin-top:6px}
.token-tabs{display:flex;gap:6px;margin-bottom:16px}
.token-tab{flex:1;padding:8px;border:1px solid var(--border);border-radius:var(--r2);background:transparent;color:var(--muted);font-size:13px;font-weight:500;transition:all 0.2s}
.token-tab.active{background:var(--accent-dim);border-color:var(--accent);color:var(--accent)}
.denom-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
.denom-btn{padding:7px;border:1px solid var(--border);border-radius:var(--r2);background:transparent;color:var(--muted2);font-size:12px;font-family:var(--mono);transition:all 0.2s}
.denom-btn:hover{border-color:var(--accent);color:var(--accent)}
.denom-btn.active{background:var(--accent-dim);border-color:var(--accent);color:var(--accent)}
.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--border)}
.toggle-label{font-size:13px;color:var(--muted2)}
.toggle-label small{display:block;font-size:11px;color:var(--muted);margin-top:1px}
.toggle{position:relative;width:40px;height:22px;flex-shrink:0}
.toggle input{opacity:0;width:0;height:0}
.toggle-slider{position:absolute;inset:0;background:var(--surface2);border:1px solid var(--border2);border-radius:20px;cursor:pointer;transition:all 0.3s}
.toggle-slider::before{content:'';position:absolute;width:16px;height:16px;border-radius:50%;background:var(--muted);left:2px;top:2px;transition:all 0.3s}
.toggle input:checked + .toggle-slider{background:var(--accent-dim);border-color:var(--accent)}
.toggle input:checked + .toggle-slider::before{background:var(--accent);transform:translateX(18px)}
.tier-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;margin-bottom:12px}
.send-btn{width:100%;padding:13px;border:none;border-radius:var(--r);background:var(--accent);color:var(--bg);font-size:14px;font-weight:600;transition:all 0.2s;margin-top:8px;box-shadow:0 0 20px rgba(34,184,230,0.2)}
.send-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 0 30px rgba(34,184,230,0.35)}
.send-btn:disabled{opacity:0.5;cursor:not-allowed}
.status-box{background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:20px;margin-top:16px}
.status-title{font-size:12px;color:var(--muted);margin-bottom:14px;font-weight:500}
.pipeline-steps{display:flex;flex-direction:column;gap:10px}
.pipeline-step{display:flex;align-items:center;gap:12px;font-size:13px}
.step-icon{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
.step-icon.done{background:rgba(52,211,153,0.15);color:var(--green);border:1px solid rgba(52,211,153,0.3)}
.step-icon.active{background:var(--accent-dim);color:var(--accent);border:1px solid rgba(34,184,230,0.3);animation:pulse-glow 1.5s infinite}
.step-icon.pending{background:var(--surface);color:var(--muted);border:1px solid var(--border)}
.step-text{color:var(--muted2)}
.step-text.active{color:var(--text)}
@keyframes pulse-glow{0%,100%{box-shadow:0 0 0 0 rgba(34,184,230,0.3)}50%{box-shadow:0 0 0 6px rgba(34,184,230,0)}}
.history-empty{text-align:center;padding:40px 20px;color:var(--muted);font-size:13px}
.history-item{padding:14px 0;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.history-item:last-child{border-bottom:none}
.history-token{width:32px;height:32px;border-radius:50%;background:var(--accent-dim);border:1px solid rgba(34,184,230,0.2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:var(--accent);flex-shrink:0}
.history-info{flex:1}
.history-amount{font-size:14px;font-weight:600;color:#fff}
.history-to{font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:2px}
.history-link{font-size:11px;color:var(--accent)}
.history-status{font-size:11px;padding:3px 8px;border-radius:20px;white-space:nowrap}
.status-ok{background:rgba(52,211,153,0.1);color:var(--green);border:1px solid rgba(52,211,153,0.2)}
.status-pending{background:var(--accent-dim);color:var(--accent);border:1px solid rgba(34,184,230,0.2)}
.key-box{background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2);padding:14px;margin-bottom:12px}
.key-label{font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:500}
.key-value{font-family:var(--mono);font-size:11px;color:var(--accent2);word-break:break-all;line-height:1.5}
.key-actions{display:flex;gap:8px;margin-top:10px}
.key-btn{flex:1;padding:7px;border:1px solid var(--border2);border-radius:var(--r2);background:transparent;color:var(--muted2);font-size:12px;transition:all 0.2s}
.key-btn:hover{border-color:var(--accent);color:var(--accent)}
.key-btn.primary{background:var(--accent-dim);border-color:var(--accent);color:var(--accent)}
.paylink-box{background:var(--surface2);border:1px solid rgba(34,184,230,0.2);border-radius:var(--r2);padding:14px;margin-top:16px}
.paylink-label{font-size:11px;color:var(--accent);margin-bottom:6px;font-weight:500}
.paylink-value{font-family:var(--mono);font-size:11px;color:var(--muted2);word-break:break-all}
.paylink-copy{width:100%;margin-top:10px;padding:8px;border:1px solid var(--accent);border-radius:var(--r2);background:var(--accent-dim);color:var(--accent);font-size:12px;font-weight:600;transition:all 0.2s}
.paylink-copy:hover{background:var(--accent);color:var(--bg)}
.scan-result{background:var(--surface2);border:1px solid rgba(52,211,153,0.2);border-radius:var(--r);padding:20px;margin-top:16px}
.scan-found{font-size:13px;color:var(--green);font-weight:600;margin-bottom:12px}
.scan-item{padding:10px 0;border-bottom:1px solid var(--border);font-size:13px}
.scan-item:last-child{border-bottom:none}
.scan-addr{font-family:var(--mono);font-size:11px;color:var(--accent2)}
.scan-amount{font-weight:600;color:#fff}
.scan-locked{font-size:11px;color:var(--amber);margin-top:3px}
.withdraw-card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2);padding:16px;margin-bottom:12px}
.withdraw-addr{font-family:var(--mono);font-size:11px;color:var(--accent2);word-break:break-all}
.withdraw-balance{font-size:18px;font-weight:600;color:#fff;margin:8px 0 4px}
.withdraw-btn{width:100%;padding:9px;border:1px solid var(--accent);border-radius:var(--r2);background:var(--accent-dim);color:var(--accent);font-size:13px;font-weight:600;transition:all 0.2s;margin-top:10px}
.withdraw-btn:hover:not(:disabled){background:var(--accent);color:var(--bg)}
.withdraw-btn:disabled{opacity:0.5;cursor:not-allowed}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px}
.modal{background:var(--surface);border:1px solid var(--border2);border-radius:16px;padding:28px;width:100%;max-width:420px;animation:modal-up 0.3s ease}
@keyframes modal-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.modal-title{font-size:16px;font-weight:600;color:#fff;margin-bottom:20px}
.modal-actions{display:flex;gap:10px;margin-top:20px}
.modal-btn{flex:1;padding:10px;border-radius:var(--r2);font-size:13px;font-weight:600;border:none;transition:all 0.2s;cursor:pointer}
.modal-btn.primary{background:var(--accent);color:var(--bg)}
.modal-btn.secondary{background:var(--surface2);color:var(--muted2);border:1px solid var(--border)}
.notif-banner{background:rgba(34,184,230,0.08);border:1px solid rgba(34,184,230,0.2);border-radius:var(--r2);padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:var(--muted2)}
.notif-btn{padding:5px 12px;border:1px solid var(--accent);border-radius:20px;background:transparent;color:var(--accent);font-size:12px;white-space:nowrap;transition:all 0.2s;cursor:pointer}
.notif-btn:hover{background:var(--accent);color:var(--bg)}
.alert{padding:12px 16px;border-radius:var(--r2);font-size:13px;margin-bottom:12px}
.alert-error{background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.2);color:var(--red)}
.alert-success{background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.2);color:var(--green)}
.alert-info{background:var(--accent-dim);border:1px solid rgba(34,184,230,0.2);color:var(--accent2)}
.how-list{display:flex;flex-direction:column;gap:0}
.how-item{display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--border)}
.how-item:last-child{border-bottom:none}
.how-num{width:26px;height:26px;border-radius:50%;background:var(--accent-dim);border:1px solid rgba(34,184,230,0.3);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:11px;color:var(--accent);flex-shrink:0;margin-top:1px}
.how-text h4{font-size:13px;font-weight:600;color:#fff;margin-bottom:2px}
.how-text p{font-size:12px;color:var(--muted);line-height:1.5}
.spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.fade-up{animation:fadeUp 0.4s ease both}
`;

const T = {
  en: {
    send:"Send",receive:"Receive",scan:"Scan",withdraw:"Withdraw",
    history:"History",connect:"Connect Wallet",connecting:"Connecting...",
    sending:"Sending...",scanning:"Scanning...",withdrawing:"Withdrawing...",
    amount:"Amount",recipient:"Recipient (stealth address or meta-address)",
    fixedDenom:"Fixed denomination (more privacy)",timelock:"Time-lock (max privacy)",
    timelockDesc:"Withdraw only on next 6h window",
    sendPrivate:"Send Private",privacyFee:"Privacy fee",
    noHistory:"No transactions yet",viewOnExplorer:"View on Basescan",
    yourMetaAddress:"Your meta-address (share to receive)",spendingKey:"Spending key (private)",
    viewingKey:"Viewing key (private)",generateKeys:"Generate new keys",
    copyLink:"Copy payment link",payLink:"Payment link",
    exportKeys:"Export keys",importKeys:"Import keys",
    scanDesc:"Scan the blockchain to find deposits sent to your stealth addresses.",
    scanBtn:"Scan blockchain",found:"deposits found",
    withdrawDesc:"Withdraw funds from your stealth addresses to your real wallet.",
    noDeposits:"No deposits found. Scan first.",
    locked:"Locked until",unlocked:"Unlocked",
    enableNotifs:"Enable notifications",notifAsk:"Get notified when your transaction completes.",
    wrongNetwork:"Please switch to Base Mainnet in MetaMask.",
    howTitle:"How privacy works",
    how1t:"Disposable address",how1d:"A new address is created for each transaction — never seen before on-chain.",
    how2t:"Multi-hop routing",how2d:"Funds pass through ephemeral wallets with random delays (20–200s).",
    how3t:"Fixed denominations",how3d:"Standard amounts create anonymity sets — your value blends with others.",
    how4t:"Stealth addresses",how4d:"Recipient is invisible on-chain. Only they can detect the deposit.",
    exportTitle:"Export keys (AES-256)",importTitle:"Import keys",
    password:"Password",confirm:"Confirm",cancel:"Cancel",
    copied:"Copied!",copyPayLink:"Copy payment link",
    backupDesc:"Import a previously exported backup file.",
  },
  pt: {
    send:"Enviar",receive:"Receber",scan:"Escanear",withdraw:"Sacar",
    history:"Histórico",connect:"Conectar Carteira",connecting:"Conectando...",
    sending:"Enviando...",scanning:"Escaneando...",withdrawing:"Sacando...",
    amount:"Valor",recipient:"Destinatário (stealth address ou meta-address)",
    fixedDenom:"Valor fixo (mais privacidade)",timelock:"Time-lock (privacidade máxima)",
    timelockDesc:"Saque apenas na próxima janela de 6h",
    sendPrivate:"Envio Privado",privacyFee:"Taxa de privacidade",
    noHistory:"Nenhuma transação ainda",viewOnExplorer:"Ver no Basescan",
    yourMetaAddress:"Seu meta-address (compartilhe para receber)",spendingKey:"Chave de gasto (privada)",
    viewingKey:"Chave de visualização (privada)",generateKeys:"Gerar novas chaves",
    copyLink:"Copiar link de pagamento",payLink:"Link de pagamento",
    exportKeys:"Exportar chaves",importKeys:"Importar chaves",
    scanDesc:"Escanear a blockchain para encontrar depósitos enviados aos seus stealth addresses.",
    scanBtn:"Escanear blockchain",found:"depósitos encontrados",
    withdrawDesc:"Sacar fundos dos seus stealth addresses para sua carteira real.",
    noDeposits:"Nenhum depósito encontrado. Escanear primeiro.",
    locked:"Bloqueado até",unlocked:"Disponível",
    enableNotifs:"Ativar notificações",notifAsk:"Seja notificado quando sua transação for concluída.",
    wrongNetwork:"Por favor, mude para a Base Mainnet no MetaMask.",
    howTitle:"Como funciona a privacidade",
    how1t:"Endereço descartável",how1d:"Um novo endereço é criado para cada transação — nunca visto antes na blockchain.",
    how2t:"Roteamento multi-hop",how2d:"Os fundos passam por carteiras efêmeras com delays aleatórios (20–200s).",
    how3t:"Denominações fixas",how3d:"Valores padronizados criam anonymity sets — seu valor se mistura com outros.",
    how4t:"Stealth addresses",how4d:"O destinatário é invisível on-chain. Só ele consegue detectar o depósito.",
    exportTitle:"Exportar chaves (AES-256)",importTitle:"Importar chaves",
    password:"Senha",confirm:"Confirmar",cancel:"Cancelar",
    copied:"Copiado!",copyPayLink:"Copiar link de pagamento",
    backupDesc:"Importe um arquivo de backup exportado anteriormente.",
  }
};

export default function App() {
  const [lang, setLang]                   = useState("pt");
  const t = T[lang];
  const [account, setAccount]             = useState("");
  const [tab, setTab]                     = useState("send");
  const [token, setToken]                 = useState("ETH");
  const [amount, setAmount]               = useState("");
  const [recipient, setRecipient]         = useState("");
  const [useFixedDenom, setUseFixedDenom] = useState(false);
  const [useTimelocked, setUseTimelocked] = useState(false);
  const [selectedDenom, setSelectedDenom] = useState(null);
  const [loading, setLoading]             = useState(false);
  const [status, setStatus]               = useState("");
  const [statusType, setStatusType]       = useState("info");
  const [history, setHistory]             = useState([]);
  const [pipelineId, setPipelineId]       = useState(null);
  const [pipelineData, setPipelineData]   = useState(null);
  const [notifPerm, setNotifPerm]         = useState(Notification?.permission || "default");
  const [spendingKey, setSpendingKey]     = useState("");
  const [viewingKey, setViewingKey]       = useState("");
  const [metaAddress, setMetaAddress]     = useState("");
  const [payLink, setPayLink]             = useState("");
  const [copied, setCopied]               = useState("");
  const [scanResults, setScanResults]     = useState([]);
  const [scanning, setScanning]           = useState(false);
  const [showExport, setShowExport]       = useState(false);
  const [modalPwd, setModalPwd]           = useState("");
  const [importData, setImportData]       = useState("");
  const [importPwd, setImportPwd]         = useState("");

  useEffect(() => {
    const sk = localStorage.getItem("sf_spending");
    const vk = localStorage.getItem("sf_viewing");
    if (sk && vk) { setSpendingKey(sk); setViewingKey(vk); buildMetaAddress(sk, vk); }
    const hist = localStorage.getItem("sf_history");
    if (hist) setHistory(JSON.parse(hist));
  }, []);

  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/\/p\/(st:.+)/);
    if (match) { setRecipient(decodeURIComponent(match[1])); setTab("send"); }
  }, []);

  useEffect(() => {
    if (!pipelineId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/status/${pipelineId}`);
        const data = await res.json();
        setPipelineData(data);
        if (data.status === "completo") {
          clearInterval(interval);
          setPipelineId(null);
          sendNotification("SilentFlow", lang === "pt" ? "Transação concluída!" : "Transaction complete!");
          showStatus(lang === "pt" ? "✓ Transação concluída!" : "✓ Transaction complete!", "success");
        }
      } catch {}
    }, 5000);
    const timeout = setTimeout(() => clearInterval(interval), 20 * 60 * 1000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [pipelineId, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildMetaAddress(sk, vk) {
    try {
      const spendPub = ethers.SigningKey.computePublicKey(sk, true);
      const viewPub  = ethers.SigningKey.computePublicKey(vk, true);
      const meta = `st:${spendPub}:${viewPub}`;
      setMetaAddress(meta);
      setPayLink(`${window.location.origin}/p/${encodeURIComponent(meta)}`);
      return meta;
    } catch { return ""; }
  }

  function generateKeys() {
    const sw = ethers.Wallet.createRandom();
    const vw = ethers.Wallet.createRandom();
    setSpendingKey(sw.privateKey);
    setViewingKey(vw.privateKey);
    localStorage.setItem("sf_spending", sw.privateKey);
    localStorage.setItem("sf_viewing", vw.privateKey);
    buildMetaAddress(sw.privateKey, vw.privateKey);
  }

  function saveHistory(entry) {
    const updated = [entry, ...history].slice(0, 50);
    setHistory(updated);
    localStorage.setItem("sf_history", JSON.stringify(updated));
  }

  function sendNotification(title, body) {
    if (Notification?.permission === "granted") new Notification(title, { body, icon: "/logo.png" });
  }

  async function requestNotifPerm() {
    const perm = await Notification?.requestPermission();
    setNotifPerm(perm);
  }

  async function connect() {
    if (!window.ethereum) return alert("MetaMask não encontrado.");
    setLoading(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== BASE_CHAIN_ID) {
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
        } catch {
          setStatus(t.wrongNetwork); setStatusType("error"); setLoading(false); return;
        }
      }
      const accounts = await provider.send("eth_requestAccounts", []);
      setAccount(accounts[0]);
      setStatus("");
    } catch (e) { setStatus(e.message); setStatusType("error"); }
    setLoading(false);
  }

  function showStatus(msg, type = "info") { setStatus(msg); setStatusType(type); }

  function copyText(text, key) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  }

  function getTierForAmount() {
    const num = parseFloat(amount) || 0;
    const usd = token === "ETH" ? num * 3000 : num;
    return getTierInfo(usd);
  }

  // ── SEND ────────────────────────────────────────────────────────────────────
  async function send() {
    if (!account) return connect();
    const val = useFixedDenom ? selectedDenom : parseFloat(amount);
    if (!val || val <= 0) return showStatus(lang === "pt" ? "Informe o valor." : "Enter an amount.", "error");
    if (!recipient.trim()) return showStatus(lang === "pt" ? "Informe o destinatário." : "Enter a recipient.", "error");

    setLoading(true);
    setStatus("");
    setPipelineData(null);

    try {
      // Derive stealth address from recipient
      let stealthAddress, ephemeralPubKey, viewTag;
      const recip = recipient.trim();
      if (recip.startsWith("st:")) {
        const clean = recip.replace("st:", "");
        const colonIdx = clean.indexOf(":", 4);
        const spendingPubKey = clean.substring(0, colonIdx);
        const viewingPubKey  = clean.substring(colonIdx + 1);
        const ephWallet = ethers.Wallet.createRandom();
        ephemeralPubKey = ethers.SigningKey.computePublicKey(ephWallet.privateKey, true);
        const h = ethers.keccak256(ethers.concat([
          ethers.getBytes(ephemeralPubKey),
          ethers.getBytes(viewingPubKey)
        ]));
        const stealthSeed = ethers.keccak256(ethers.concat([
          ethers.getBytes(h),
          ethers.getBytes(spendingPubKey)
        ]));
        stealthAddress = new ethers.Wallet(stealthSeed).address;
        viewTag = parseInt(h.slice(2, 4), 16);
      } else {
        stealthAddress  = recip;
        ephemeralPubKey = ethers.hexlify(ethers.randomBytes(33));
        viewTag = 0;
      }

      // Call backend /entrada with all required params
      const params = new URLSearchParams({
        token,
        stealthAddress,
        ephemeralPubKey,
        viewTag: String(viewTag),
        timelocked: String(useTimelocked)
      });
      const entryRes  = await fetch(`${BACKEND_URL}/entrada?${params}`);
      const entryData = await entryRes.json();
      if (entryData.erro) throw new Error(entryData.erro);
      const entryAddress = entryData.entradaAddress;
      if (!entryAddress) throw new Error(lang === "pt" ? "Backend não retornou endereço de entrada." : "Backend did not return entry address.");

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const decimals = TOKENS[token].decimals;
      const valBig   = ethers.parseUnits(val.toString(), decimals);

      let txHash;
      if (token === "ETH") {
        const tx = await signer.sendTransaction({ to: entryAddress, value: valBig });
        await tx.wait();
        txHash = tx.hash;
      } else {
        const tc  = new ethers.Contract(TOKENS[token].address, ERC20_ABI, signer);
        const allow = await tc.allowance(account, entryAddress);
        if (allow < valBig) { const a = await tc.approve(entryAddress, valBig); await a.wait(); }
        const erc20 = new ethers.Contract(TOKENS[token].address, ERC20_ABI, signer);
        const tx = await erc20.transfer(entryAddress, valBig);
        await tx.wait();
        txHash = tx.hash;
      }

      saveHistory({ hash: txHash, token, amount: val, to: recip, ts: Date.now(), status: "pending" });
      showStatus(lang === "pt" ? "Enviado! Processando pipeline de privacidade..." : "Sent! Processing privacy pipeline...", "info");

      // Poll for pipeline ID
      try {
        const aguardar = await fetch(`${BACKEND_URL}/aguardar/${entryAddress}`);
        const aData    = await aguardar.json();
        if (aData.pipelineId) setPipelineId(aData.pipelineId);
      } catch {}

    } catch (e) {
      showStatus(e.message || "Erro ao enviar.", "error");
    }
    setLoading(false);
  }

  // ── SCAN ────────────────────────────────────────────────────────────────────
  async function scan() {
    if (!spendingKey || !viewingKey) {
      return showStatus(lang === "pt" ? "Gere suas chaves primeiro na aba Receber." : "Generate your keys first in the Receive tab.", "error");
    }
    setScanning(true);
    setScanResults([]);
    try {
      const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
      const filter   = contract.filters.StealthDeposit();
      const current  = await provider.getBlockNumber();
      const from     = Math.max(0, current - 50000);
      const events   = await contract.queryFilter(filter, from, current);
      const found    = [];
      for (const ev of events) {
        const [ephPubKey, stealthAddr, tokenAddr, amt, vTag, timelocked, unlockAt] = ev.args;
        const result = tryDecryptDeposit(ephPubKey, stealthAddr, Number(vTag), spendingKey, viewingKey);
        if (result) {
          const tokenSym = Object.keys(TOKENS).find(k => TOKENS[k].address.toLowerCase() === tokenAddr.toLowerCase()) || "?";
          const dec = TOKENS[tokenSym]?.decimals || 18;
          found.push({
            stealthAddress: result.stealthAddress,
            stealthPrivKey: result.stealthPrivKey,
            token: tokenSym, tokenAddr,
            amount: ethers.formatUnits(amt, dec),
            timelocked, unlockAt: Number(unlockAt),
            txHash: ev.transactionHash
          });
        }
      }
      setScanResults(found);
      if (found.length === 0) showStatus(lang === "pt" ? "Nenhum depósito encontrado." : "No deposits found.", "info");
    } catch (e) { showStatus(e.message, "error"); }
    setScanning(false);
  }

  // ── WITHDRAW ────────────────────────────────────────────────────────────────
  async function doWithdraw(item) {
    setLoading(true);
    try {
      const stealthWallet = new ethers.Wallet(item.stealthPrivKey);
      const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
      const nonce    = await contract.withdrawNonces(item.stealthAddress);
      const chainId  = BigInt(BASE_CHAIN_ID);
      const packedHash = ethers.keccak256(ethers.solidityPacked(
        ["address","address","address","uint256","uint256"],
        [item.stealthAddress, item.tokenAddr, account, nonce, chainId]
      ));
      const sig = await stealthWallet.signMessage(ethers.getBytes(packedHash));
      const res = await fetch(`${BACKEND_URL}/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stealthAddress: item.stealthAddress, token: item.tokenAddr, recipient: account, sig })
      });
      const data = await res.json();
      if (data.ok) {
        showStatus(lang === "pt" ? "Saque realizado!" : "Withdrawal successful!", "success");
        setScanResults(prev => prev.filter(r => r.stealthAddress !== item.stealthAddress));
      } else {
        showStatus(data.error || "Erro no saque.", "error");
      }
    } catch (e) { showStatus(e.message, "error"); }
    setLoading(false);
  }

  // ── EXPORT / IMPORT ─────────────────────────────────────────────────────────
  async function handleExport() {
    if (!modalPwd) return;
    const encrypted = await encryptKeys({ spendingKey, viewingKey }, modalPwd);
    const blob = new Blob([encrypted], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "silentflow-keys.enc"; a.click();
    setShowExport(false); setModalPwd("");
  }

  async function handleImport() {
    if (!importPwd || !importData) return;
    try {
      const { spendingKey: sk, viewingKey: vk } = await decryptKeys(importData.trim(), importPwd);
      setSpendingKey(sk); setViewingKey(vk);
      localStorage.setItem("sf_spending", sk);
      localStorage.setItem("sf_viewing", vk);
      buildMetaAddress(sk, vk);
      setImportData(""); setImportPwd("");
      showStatus(lang === "pt" ? "Chaves importadas!" : "Keys imported!", "success");
    } catch {
      showStatus(lang === "pt" ? "Senha incorreta ou arquivo inválido." : "Wrong password or invalid file.", "error");
    }
  }

  // ── PIPELINE STEPS ──────────────────────────────────────────────────────────
  const pipelineSteps = [
    { key: "recebido",  label: lang === "pt" ? "Entrada recebida"          : "Entry received" },
    { key: "splitting", label: lang === "pt" ? "Split em denominações"     : "Splitting denominations" },
    { key: "hops",      label: lang === "pt" ? "Multi-hop routing"         : "Multi-hop routing" },
    { key: "completo",  label: lang === "pt" ? "Depósito no stealth address" : "Deposited to stealth address" }
  ];
  function getStepStatus(stepKey) {
    if (!pipelineData) return "pending";
    const order = ["recebido","splitting","hops","completo"];
    const ci = order.indexOf(pipelineData.status);
    const si = order.indexOf(stepKey);
    if (si < ci) return "done";
    if (si === ci) return "active";
    return "pending";
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{S}</style>
      <div className="app">

        {/* NAV */}
        <nav className="nav">
          <div className="nav-left">
            <div className="nav-logo">
              <img src="/logo.png" alt="SilentFlow" onError={e => e.target.style.display="none"} />
              <span>SILENTFLOW</span>
            </div>
            <span className="net-badge">● BASE MAINNET</span>
          </div>
          <div className="nav-right">
            <button className="lang-btn" onClick={() => setLang(l => l === "pt" ? "en" : "pt")}>
              {lang === "pt" ? "EN" : "PT"}
            </button>
            {account ? (
              <div className="account-pill">
                <span className="account-dot" />
                {account.slice(0,6)}...{account.slice(-4)}
              </div>
            ) : (
              <button className="connect-btn" onClick={connect} disabled={loading}>
                {loading ? t.connecting : t.connect}
              </button>
            )}
          </div>
        </nav>

        {/* MAIN */}
        <main className="main">

          {notifPerm === "default" && (
            <div className="notif-banner">
              <span>{t.notifAsk}</span>
              <button className="notif-btn" onClick={requestNotifPerm}>{t.enableNotifs}</button>
            </div>
          )}

          {status && <div className={`alert alert-${statusType} fade-up`}>{status}</div>}

          {/* TABS */}
          <div className="tabs">
            {["send","receive","scan","withdraw"].map(k => (
              <button key={k} className={`tab ${tab === k ? "active" : ""}`}
                onClick={() => { setTab(k); setStatus(""); }}>
                {t[k]}
              </button>
            ))}
          </div>

          {/* ── SEND ── */}
          {tab === "send" && (
            <div className="grid fade-up">
              <div>
                <div className="card">
                  <div className="card-title">{t.sendPrivate}</div>
                  <p className="form-sub" style={{marginBottom:16}}>Non-custodial · BASE MAINNET</p>

                  <div className="token-tabs">
                    {["ETH","USDC","USDT"].map(tk => (
                      <button key={tk} className={`token-tab ${token === tk ? "active" : ""}`}
                        onClick={() => { setToken(tk); setSelectedDenom(null); setAmount(""); }}>
                        {tk}
                      </button>
                    ))}
                  </div>

                  {amount && !useFixedDenom && (() => {
                    const tier = getTierForAmount();
                    return (
                      <div className="tier-badge" style={{background:`${tier.color}18`,color:tier.color,border:`1px solid ${tier.color}33`}}>
                        ⬡ {tier.label} — {tier.bps / 100}% fee
                      </div>
                    );
                  })()}

                  <div className="toggle-row">
                    <div className="toggle-label">
                      {t.fixedDenom}
                      <small style={{color:"var(--accent)"}}>+privacy</small>
                    </div>
                    <label className="toggle">
                      <input type="checkbox" checked={useFixedDenom}
                        onChange={e => { setUseFixedDenom(e.target.checked); setSelectedDenom(null); setAmount(""); }} />
                      <span className="toggle-slider" />
                    </label>
                  </div>

                  {useFixedDenom ? (
                    <div className="form-group" style={{marginTop:14}}>
                      <div className="form-label">{t.amount}</div>
                      <div className="denom-grid">
                        {DENOMS[token].map(d => (
                          <button key={d} className={`denom-btn ${selectedDenom === d ? "active" : ""}`}
                            onClick={() => setSelectedDenom(d)}>
                            {d} {token}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="form-group" style={{marginTop:14}}>
                      <div className="form-label">{t.amount}</div>
                      <input className="form-input" type="number" placeholder="0.00"
                        value={amount} onChange={e => setAmount(e.target.value)} step="any" min="0" />
                    </div>
                  )}

                  <div className="form-group">
                    <div className="form-label">{t.recipient}</div>
                    <input className="form-input" placeholder="st:0x... ou 0x..."
                      value={recipient} onChange={e => setRecipient(e.target.value)} />
                  </div>

                  <div className="toggle-row">
                    <div className="toggle-label">
                      {t.timelock}
                      <small>{t.timelockDesc}</small>
                    </div>
                    <label className="toggle">
                      <input type="checkbox" checked={useTimelocked} onChange={e => setUseTimelocked(e.target.checked)} />
                      <span className="toggle-slider" />
                    </label>
                  </div>

                  <button className="send-btn" onClick={send} disabled={loading}>
                    {loading ? <><span className="spinner" /> {t.sending}</> : `→ ${t.send}`}
                  </button>
                </div>

                {pipelineData && (
                  <div className="status-box fade-up">
                    <div className="status-title">Pipeline de privacidade</div>
                    <div className="pipeline-steps">
                      {pipelineSteps.map(step => {
                        const s = getStepStatus(step.key);
                        return (
                          <div key={step.key} className="pipeline-step">
                            <div className={`step-icon ${s}`}>
                              {s === "done" ? "✓" : s === "active" ? "◉" : "○"}
                            </div>
                            <span className={`step-text ${s === "active" ? "active" : ""}`}>{step.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="card">
                  <div className="card-title">{t.history}</div>
                  {history.length === 0 ? (
                    <div className="history-empty">{t.noHistory}</div>
                  ) : history.map((h, i) => (
                    <div key={i} className="history-item">
                      <div className="history-token">{h.token?.slice(0,1)}</div>
                      <div className="history-info">
                        <div className="history-amount">{h.amount} {h.token}</div>
                        <div className="history-to">{h.to?.slice(0,24)}...</div>
                        <a className="history-link" href={`https://basescan.org/tx/${h.hash}`} target="_blank" rel="noreferrer">
                          {t.viewOnExplorer} ↗
                        </a>
                      </div>
                      <span className={`history-status ${h.status === "done" ? "status-ok" : "status-pending"}`}>
                        {h.status === "done" ? "✓" : "..."}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="card" style={{marginTop:20}}>
                  <div className="card-title">{t.howTitle}</div>
                  <div className="how-list">
                    {[[t.how1t,t.how1d],[t.how2t,t.how2d],[t.how3t,t.how3d],[t.how4t,t.how4d]].map(([title,desc],i) => (
                      <div key={i} className="how-item">
                        <div className="how-num">{i+1}</div>
                        <div className="how-text"><h4>{title}</h4><p>{desc}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── RECEIVE ── */}
          {tab === "receive" && (
            <div className="grid fade-up">
              <div className="card">
                <div className="card-title">{t.receive}</div>
                {!spendingKey ? (
                  <>
                    <p style={{color:"var(--muted)",fontSize:13,marginBottom:20}}>
                      {lang === "pt" ? "Gere suas chaves stealth para receber pagamentos de forma privada." : "Generate your stealth keys to receive payments privately."}
                    </p>
                    <button className="send-btn" onClick={generateKeys}>{t.generateKeys}</button>
                  </>
                ) : (
                  <>
                    <div className="key-box">
                      <div className="key-label">{t.yourMetaAddress}</div>
                      <div className="key-value">{metaAddress}</div>
                      <div className="key-actions">
                        <button className="key-btn primary" onClick={() => copyText(metaAddress, "meta")}>
                          {copied === "meta" ? t.copied : lang === "pt" ? "Copiar" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <div className="key-box">
                      <div className="key-label">{t.spendingKey} ⚠️</div>
                      <div className="key-value" style={{filter:"blur(4px)",userSelect:"none"}}
                        onMouseEnter={e => e.target.style.filter="none"}
                        onMouseLeave={e => e.target.style.filter="blur(4px)"}>
                        {spendingKey}
                      </div>
                    </div>
                    <div className="key-box">
                      <div className="key-label">{t.viewingKey} ⚠️</div>
                      <div className="key-value" style={{filter:"blur(4px)",userSelect:"none"}}
                        onMouseEnter={e => e.target.style.filter="none"}
                        onMouseLeave={e => e.target.style.filter="blur(4px)"}>
                        {viewingKey}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:4}}>
                      <button className="key-btn" onClick={() => setShowExport(true)}>{t.exportKeys}</button>
                      <button className="key-btn" onClick={generateKeys}>{t.generateKeys}</button>
                    </div>
                    {payLink && (
                      <div className="paylink-box">
                        <div className="paylink-label">🔗 {t.payLink}</div>
                        <div className="paylink-value">{payLink}</div>
                        <button className="paylink-copy" onClick={() => copyText(payLink, "link")}>
                          {copied === "link" ? t.copied : t.copyPayLink}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="card">
                <div className="card-title">{t.importKeys}</div>
                <p style={{color:"var(--muted)",fontSize:13,marginBottom:16}}>{t.backupDesc}</p>
                <div className="form-group">
                  <div className="form-label">{lang === "pt" ? "Dados do backup" : "Backup data"}</div>
                  <textarea className="form-input" rows={4}
                    placeholder={lang === "pt" ? "Cole o conteúdo do arquivo .enc aqui" : "Paste the .enc file content here"}
                    value={importData} onChange={e => setImportData(e.target.value)} style={{resize:"vertical"}} />
                </div>
                <div className="form-group">
                  <div className="form-label">{t.password}</div>
                  <input className="form-input" type="password" placeholder="••••••••"
                    value={importPwd} onChange={e => setImportPwd(e.target.value)} />
                </div>
                <button className="send-btn" onClick={handleImport}>{t.importKeys}</button>
              </div>
            </div>
          )}

          {/* ── SCAN ── */}
          {tab === "scan" && (
            <div className="grid fade-up">
              <div className="card">
                <div className="card-title">{t.scan}</div>
                <p style={{color:"var(--muted)",fontSize:13,marginBottom:20}}>{t.scanDesc}</p>
                {!spendingKey && (
                  <div className="alert alert-error">
                    {lang === "pt" ? "Gere suas chaves na aba Receber primeiro." : "Generate your keys in the Receive tab first."}
                  </div>
                )}
                <button className="send-btn" onClick={scan} disabled={scanning || !spendingKey}>
                  {scanning ? <><span className="spinner" /> {t.scanning}</> : t.scanBtn}
                </button>
                {scanResults.length > 0 && (
                  <div className="scan-result">
                    <div className="scan-found">✓ {scanResults.length} {t.found}</div>
                    {scanResults.map((r,i) => (
                      <div key={i} className="scan-item">
                        <div className="scan-amount">{r.amount} {r.token}</div>
                        <div className="scan-addr">{r.stealthAddress}</div>
                        {r.timelocked && r.unlockAt > Date.now()/1000 && (
                          <div className="scan-locked">🔒 {t.locked}: {new Date(r.unlockAt*1000).toLocaleString()}</div>
                        )}
                        <a href={`https://basescan.org/tx/${r.txHash}`} target="_blank" rel="noreferrer"
                          style={{fontSize:11,color:"var(--accent)"}}>Basescan ↗</a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="card">
                <div className="card-title" style={{color:"var(--muted)"}}>
                  {lang === "pt" ? "Como funciona o scan" : "How scanning works"}
                </div>
                <div className="how-list">
                  {[
                    [lang==="pt"?"Busca eventos on-chain":"Fetches on-chain events", lang==="pt"?"Busca os últimos 50.000 blocos no contrato SilentFlow.":"Scans the last 50,000 blocks on the SilentFlow contract."],
                    [lang==="pt"?"Testa cada depósito":"Tests each deposit", lang==="pt"?"Usa suas chaves privadas localmente para descriptografar.":"Uses your private keys locally to decrypt events."],
                    [lang==="pt"?"100% local":"100% local", lang==="pt"?"Suas chaves nunca saem do browser. Zero exposição.":"Your keys never leave the browser. Zero exposure."],
                  ].map(([title,desc],i) => (
                    <div key={i} className="how-item">
                      <div className="how-num">{i+1}</div>
                      <div className="how-text"><h4>{title}</h4><p>{desc}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── WITHDRAW ── */}
          {tab === "withdraw" && (
            <div className="grid fade-up">
              <div className="card">
                <div className="card-title">{t.withdraw}</div>
                <p style={{color:"var(--muted)",fontSize:13,marginBottom:20}}>{t.withdrawDesc}</p>
                {!account && (
                  <div className="alert alert-info">
                    {lang === "pt" ? "Conecte sua carteira para sacar." : "Connect your wallet to withdraw."}
                  </div>
                )}
                {scanResults.length === 0 ? (
                  <div style={{textAlign:"center",padding:"40px 20px",color:"var(--muted)",fontSize:13}}>
                    {t.noDeposits}
                    <br />
                    <button className="key-btn" style={{marginTop:12,width:"auto",padding:"8px 20px"}}
                      onClick={() => setTab("scan")}>→ {t.scan}</button>
                  </div>
                ) : scanResults.map((r,i) => {
                  const isLocked = r.timelocked && r.unlockAt > Date.now()/1000;
                  return (
                    <div key={i} className="withdraw-card">
                      <div className="withdraw-addr">{r.stealthAddress}</div>
                      <div className="withdraw-balance">{r.amount} {r.token}</div>
                      {isLocked
                        ? <div className="scan-locked">🔒 {t.locked}: {new Date(r.unlockAt*1000).toLocaleString()}</div>
                        : <div style={{fontSize:11,color:"var(--green)"}}>✓ {t.unlocked}</div>}
                      <button className="withdraw-btn" onClick={() => doWithdraw(r)}
                        disabled={loading || isLocked || !account}>
                        {loading ? <><span className="spinner" /> {t.withdrawing}</> : `→ ${t.withdraw}`}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="card">
                <div className="card-title" style={{color:"var(--muted)"}}>
                  {lang === "pt" ? "Saque gasless" : "Gasless withdrawal"}
                </div>
                <p style={{fontSize:13,color:"var(--muted)",lineHeight:1.7}}>
                  {lang === "pt"
                    ? "O saque é realizado via relayer — você não precisa de ETH no stealth address. O backend paga o gas e desconta da taxa de privacidade."
                    : "Withdrawal is done via relayer — you don't need ETH in the stealth address. The backend pays gas and deducts it from the privacy fee."}
                </p>
                <div style={{marginTop:20,padding:16,background:"var(--surface2)",borderRadius:"var(--r2)",border:"1px solid var(--border)"}}>
                  <div style={{fontSize:12,color:"var(--muted)",marginBottom:8}}>
                    {lang === "pt" ? "Contrato verificado" : "Verified contract"}
                  </div>
                  <a href={`https://basescan.org/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer"
                    style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--accent2)",wordBreak:"break-all"}}>
                    {CONTRACT_ADDRESS}
                  </a>
                </div>
              </div>
            </div>
          )}

        </main>

        {/* EXPORT MODAL */}
        {showExport && (
          <div className="modal-overlay" onClick={() => setShowExport(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-title">{t.exportTitle}</div>
              <div className="form-group">
                <div className="form-label">{t.password}</div>
                <input className="form-input" type="password" placeholder="••••••••"
                  value={modalPwd} onChange={e => setModalPwd(e.target.value)} />
              </div>
              <div className="modal-actions">
                <button className="modal-btn secondary" onClick={() => { setShowExport(false); setModalPwd(""); }}>{t.cancel}</button>
                <button className="modal-btn primary" onClick={handleExport}>{t.confirm}</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  );
}
