/* eslint-disable no-undef */
import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";

const TOKEN_ICONS = {
  ETH:  <img src="https://assets.coingecko.com/coins/images/279/small/ethereum.png" width="18" height="18" style={{borderRadius:"50%"}} alt="ETH"/>,
  USDC: <img src="https://assets.coingecko.com/coins/images/6319/small/usdc.png" width="18" height="18" style={{borderRadius:"50%"}} alt="USDC"/>,
  USDT: <img src="https://assets.coingecko.com/coins/images/325/small/tether.png" width="18" height="18" style={{borderRadius:"50%"}} alt="USDT"/>,
  POL:  <img src="https://assets.coingecko.com/coins/images/4713/small/polygon.png" width="18" height="18" style={{borderRadius:"50%"}} alt="POL"/>,
  BNB:  <img src="https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" width="18" height="18" style={{borderRadius:"50%"}} alt="BNB"/>,
};

const NETWORKS = {
  base: {
    name: "Base",
    chainId: 8453,
    chainHex: "0x2105",
    contractAddress: "0x99f4a6Deb7643a1DDa10115BFE3c7a4D9C4Ef09B",
    backendUrl: "https://silentflow-production.up.railway.app",
    explorer: "https://basescan.org",
    rpc: "https://mainnet.base.org",
    tokens: {
      ETH:  { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
      USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      USDT: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 }
    },
    nativeSymbol: "ETH",
    color: "#22c5f0",
  },
  polygon: {
    name: "Polygon",
    chainId: 137,
    chainHex: "0x89",
    contractAddress: "0x074c000416A4725EDA5F53EE7b690f82f250847B",
    backendUrl: "https://silentflow-production-4600.up.railway.app",
    explorer: "https://polygonscan.com",
    rpc: "https://polygon-rpc.com",
    tokens: {
      POL:  { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
      USDC: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
      USDT: { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 }
    },
    nativeSymbol: "POL",
    color: "#8247e5",
  },
  bnb: {
    name: "BNB",
    chainId: 56,
    chainHex: "0x38",
    contractAddress: "0x3d2E4d11Be4B2c1747eb0ABDC7f3118CA33d59c6",
    backendUrl: "https://silentflow-production-675a.up.railway.app",
    explorer: "https://bscscan.com",
    rpc: "https://bsc-dataseed.binance.org",
    tokens: {
      BNB:  { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
      USDC: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
      USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 }
    },
    nativeSymbol: "BNB",
    color: "#F0B90B",
  }
};

const ABI = [
  "function withdrawFor(address stealthAddress, address token, address recipient, bytes calldata sig) external",
  "function withdrawNonces(address) external view returns (uint256)",
  "event StealthDeposit(bytes ephemeralPubKey, address indexed stealthAddress, address token, uint256 amount, uint8 viewTag, bool timelocked, uint256 unlockAt)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];



const DENOMS_BY_TOKEN = {
  ETH:  [0.01, 0.05, 0.1, 0.5, 1, 5],
  POL:  [1, 5, 10, 50, 100],
  BNB:  [0.01, 0.05, 0.1, 0.5, 1],
  USDC: [10, 50, 100, 500, 1000],
  USDT: [10, 50, 100, 500, 1000]
};

function getTierInfo(usd) {
  if (usd >= 5000) return { label: "Premium", bps: 20, color: "#a78bfa" };
  if (usd >= 500)  return { label: "Volume",  bps: 35, color: "#34d399" };
  return                  { label: "Standard", bps: 50, color: "#22c5f0" };
}

function fmtAddr(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function tryDecrypt(ephPub, stealthOn, vTagOn, sk, vk) {
  try {
    const vPub = ethers.SigningKey.computePublicKey(vk, true);
    const sPub = ethers.SigningKey.computePublicKey(sk, true);
    const h = ethers.keccak256(ethers.concat([ethers.getBytes(ephPub), ethers.getBytes(vPub)]));
    if (parseInt(h.slice(2,4),16) !== vTagOn) return null;
    const seed = ethers.keccak256(ethers.concat([ethers.getBytes(h), ethers.getBytes(sPub)]));
    const w = new ethers.Wallet(seed);
    if (w.address.toLowerCase() !== stealthOn.toLowerCase()) return null;
    return { stealthAddress: w.address, stealthPrivKey: seed };
  } catch { return null; }
}

async function encryptKeys(data, pwd) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(pwd), "PBKDF2", false, ["deriveKey"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey({ name:"PBKDF2", salt, iterations:100000, hash:"SHA-256" }, km, { name:"AES-GCM", length:256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name:"AES-GCM", iv }, key, enc.encode(JSON.stringify(data)));
  return btoa(JSON.stringify({ salt:Array.from(salt), iv:Array.from(iv), ct:Array.from(new Uint8Array(ct)) }));
}

async function decryptKeys(b64, pwd) {
  const enc = new TextEncoder();
  const { salt, iv, ct } = JSON.parse(atob(b64));
  const km = await crypto.subtle.importKey("raw", enc.encode(pwd), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name:"PBKDF2", salt:new Uint8Array(salt), iterations:100000, hash:"SHA-256" }, km, { name:"AES-GCM", length:256 }, false, ["decrypt"]);
  const dec = await crypto.subtle.decrypt({ name:"AES-GCM", iv:new Uint8Array(iv) }, key, new Uint8Array(ct));
  return JSON.parse(new TextDecoder().decode(dec));
}

const T = {
  pt: {
    send:"Enviar", receive:"Receber", history:"Historico", scan:"Recebidos",
    sendTitle:"Envio protegido", amount:"Voce envia", to:"Para",
    toPlaceholder:"Endereco ou link de pagamento",
    fixedDenom:"Valor fixo", timelock:"Atraso 6h",
    sendBtn:"Enviar sem expor sua carteira", sending:"Processando...",
    connectBtn:"Conectar carteira", connecting:"Conectando...",
    wrongNet:"Mude para a rede Base no MetaMask.",
    fee:"Taxa de privacidade",
    enterAmount:"Informe o valor.", enterTo:"Informe o destinatario.",
    sent:"Enviado! Processando...", txDone:"Transacao concluida!",
    noHistory:"Nenhum envio ainda", noHistoryDesc:"Seus envios privados aparecao aqui.",
    basescan:"Ver no Basescan",
    receiveTitle:"Receber pagamento", yourAddress:"Seu endereco de recebimento",
    copy:"Copiar endereco", copied:"Copiado!",
    spendKey:"Chave de acesso", viewKey:"Chave de visualizacao",
    keysHint:"Passe o mouse para revelar. Nunca compartilhe.",
    paylink:"Link de pagamento", paylinkDesc:"Compartilhe para receber pagamentos.",
    copyLink:"Copiar link", exportKeys:"Backup", newKeys:"Novo endereco",
    noKeys:"Sem endereco de recebimento", noKeysDesc:"Crie um endereco para receber pagamentos privados.",
    createKeys:"Criar endereco", importKeys:"Importar backup",
    importDesc:"Restaure suas chaves a partir de um backup.",
    backupContent:"Conteudo do backup", backupPaste:"Cole o conteudo do arquivo .enc aqui",
    password:"Senha", confirm:"Confirmar", cancel:"Cancelar",
    exportTitle:"Backup das chaves",
    scanTitle:"Verificar recebimentos", scanDesc:"Verifique pagamentos privados recebidos.",
    scanBtn:"Verificar agora", scanning:"Verificando...",
    found:"pagamento(s) encontrado(s)", noFound:"Nenhum pagamento encontrado.",
    unlocked:"Disponivel para saque", locked:"Bloqueado ate",
    withdrawBtn:"Sacar agora", withdrawing:"Sacando...", withdrawDone:"Saque realizado!",
    fundsFound:"Voce tem fundos para sacar!", fundsFoundDesc:"pagamento(s) encontrado(s)",
    sacar:"Sacar",
    pipe1:"Entrada recebida", pipe2:"Dividindo em partes",
    pipe3:"Roteando com privacidade", pipe4:"Depositado no stealth address",
    importDone:"Chaves importadas!", wrongPwd:"Senha incorreta ou arquivo invalido.",
    noKeysForScan:"Crie seu endereco de recebimento primeiro.",
    gasless:"Saque sem gas - o protocolo cobre o custo.",
    or:"ou",
  },
  en: {
    send:"Send", receive:"Receive", history:"History", scan:"Received",
    sendTitle:"Protected transfer", amount:"You send", to:"To",
    toPlaceholder:"Address or payment link",
    fixedDenom:"Fixed amount", timelock:"6h delay",
    sendBtn:"Send without exposing your wallet", sending:"Processing...",
    connectBtn:"Connect wallet", connecting:"Connecting...",
    wrongNet:"Switch to Base network in MetaMask.",
    fee:"Privacy fee",
    enterAmount:"Enter an amount.", enterTo:"Enter a recipient.",
    sent:"Sent! Processing...", txDone:"Transaction complete!",
    noHistory:"No transfers yet", noHistoryDesc:"Your private transfers will appear here.",
    basescan:"View on Basescan",
    receiveTitle:"Receive payment", yourAddress:"Your receiving address",
    copy:"Copy address", copied:"Copied!",
    spendKey:"Spending key", viewKey:"Viewing key",
    keysHint:"Hover to reveal. Never share.",
    paylink:"Payment link", paylinkDesc:"Share to receive direct payments.",
    copyLink:"Copy link", exportKeys:"Backup", newKeys:"New address",
    noKeys:"No receiving address", noKeysDesc:"Create an address to receive private payments.",
    createKeys:"Create address", importKeys:"Import backup",
    importDesc:"Restore your keys from a backup file.",
    backupContent:"Backup content", backupPaste:"Paste .enc file content here",
    password:"Password", confirm:"Confirm", cancel:"Cancel",
    exportTitle:"Key backup",
    scanTitle:"Check received payments", scanDesc:"Check for private payments received.",
    scanBtn:"Check now", scanning:"Checking...",
    found:"payment(s) found", noFound:"No payments found.",
    unlocked:"Available to withdraw", locked:"Locked until",
    withdrawBtn:"Withdraw now", withdrawing:"Withdrawing...", withdrawDone:"Withdrawal successful!",
    fundsFound:"You have funds to withdraw!", fundsFoundDesc:"payment(s) found",
    sacar:"Withdraw",
    pipe1:"Entry received", pipe2:"Splitting into parts",
    pipe3:"Routing privately", pipe4:"Deposited to stealth address",
    importDone:"Keys imported!", wrongPwd:"Wrong password or invalid file.",
    noKeysForScan:"Create your receiving address first.",
    gasless:"Gasless withdrawal - the protocol covers the cost.",
    or:"or",
  }
};

const S = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#08090d;--surface:#111520;--surface2:#181c2e;--surface3:#1e2236;
  --border:rgba(255,255,255,0.06);--border2:rgba(255,255,255,0.1);--border3:rgba(255,255,255,0.15);
  --accent:#22c5f0;--accent2:#5dd8f8;--accent-dim:rgba(34,197,240,0.1);--accent-glow:rgba(34,197,240,0.2);
  --green:#34d399;--green-dim:rgba(52,211,153,0.1);
  --amber:#fbbf24;--red:#f87171;--red-dim:rgba(248,113,113,0.08);
  --text:#f0f4ff;--text2:#8892a4;--text3:#4a5568;
  --sans:'DM Sans',sans-serif;--mono:'JetBrains Mono',monospace;
  --r:20px;--r2:14px;--r3:10px;--r4:8px;
}
html,body,#root{height:100%}
body{background:var(--bg);color:var(--text);font-family:var(--sans);-webkit-font-smoothing:antialiased;overflow-x:hidden}
button{cursor:pointer;font-family:var(--sans);border:none;outline:none}
input,textarea{font-family:var(--sans);outline:none;border:none}
a{color:var(--accent);text-decoration:none}
.app{min-height:100vh;display:flex;flex-direction:column}
.glow{position:fixed;top:-300px;left:50%;transform:translateX(-50%);width:900px;height:600px;border-radius:50%;background:radial-gradient(ellipse,rgba(34,197,240,0.035) 0%,transparent 65%);pointer-events:none;z-index:0}
.nav{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:rgba(8,9,13,0.9);backdrop-filter:blur(24px);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10}
.nav-brand{display:flex;align-items:center;gap:10px}
.nav-logo{width:28px;height:28px;filter:drop-shadow(0 0 12px rgba(34,197,240,0.5))}
.nav-name{font-size:15px;font-weight:700;letter-spacing:0.05em;color:#fff}
.nav-badge{font-family:var(--mono);font-size:9px;color:var(--green);background:var(--green-dim);border:1px solid rgba(52,211,153,0.2);padding:3px 8px;border-radius:20px;display:flex;align-items:center;gap:4px}
.nav-badge::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--green);flex-shrink:0;animation:blink 2s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
.nav-right{display:flex;align-items:center;gap:8px}
.nav-lang{background:transparent;border:1px solid var(--border2);color:var(--text2);font-size:11px;padding:5px 10px;border-radius:20px;transition:all 0.2s}
.nav-lang:hover{border-color:var(--accent);color:var(--accent)}
.nav-wallet{display:flex;align-items:center;gap:7px;background:var(--surface);border:1px solid var(--border2);padding:7px 13px;border-radius:20px;font-family:var(--mono);font-size:11px;color:var(--accent2);cursor:pointer;transition:border-color 0.2s}
.nav-wallet:hover{border-color:var(--accent)}
.wallet-dot{width:6px;height:6px;border-radius:50%;background:var(--green);flex-shrink:0}
.nav-connect{background:var(--accent);color:#08090d;font-weight:700;font-size:13px;padding:8px 18px;border-radius:var(--r3);transition:all 0.2s;box-shadow:0 0 20px var(--accent-glow)}
.nav-connect:hover{opacity:0.9;transform:translateY(-1px)}
.main{flex:1;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px 0;position:relative;z-index:1}
.card-wrap{width:100%;max-width:460px}
.swap-card{background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);padding:20px;box-shadow:0 8px 40px rgba(0,0,0,0.4)}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
.card-title{font-size:16px;font-weight:600;color:var(--text)}
.card-settings{display:flex;align-items:center;gap:6px}
.settings-btn{height:32px;padding:0 12px;border-radius:20px;background:var(--surface2);border:1px solid var(--border);color:var(--text2);font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center;transition:all 0.2s;white-space:nowrap}
.settings-btn:hover{border-color:var(--border2);color:var(--text)}
.settings-btn.on{background:var(--accent-dim);border-color:rgba(34,197,240,0.3);color:var(--accent)}
.amount-box{background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2);padding:16px;margin-bottom:6px;transition:border-color 0.2s}
.amount-box:focus-within{border-color:rgba(34,197,240,0.3)}
.amount-label{font-size:12px;color:var(--text2);margin-bottom:10px;font-weight:500}
.amount-row{display:flex;align-items:center;gap:12px}
.amount-input{flex:1;background:transparent;color:var(--text);font-size:32px;font-weight:600;width:0;min-width:0}
.amount-input::placeholder{color:var(--text3)}
.token-select{display:flex;align-items:center;gap:8px;background:var(--surface3);border:1px solid var(--border2);border-radius:20px;padding:8px 14px;color:var(--text);font-size:14px;font-weight:600;white-space:nowrap;transition:all 0.2s;flex-shrink:0}
.token-select:hover{border-color:var(--border3)}
.token-chevron{color:var(--text2);font-size:11px}
.amount-usd{font-size:12px;color:var(--text2);margin-top:6px}
.token-dropdown{position:absolute;top:calc(100% + 6px);right:0;z-index:100;background:var(--surface);border:1px solid var(--border2);border-radius:var(--r2);padding:6px;box-shadow:0 8px 32px rgba(0,0,0,0.5);min-width:150px}
.token-option{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--r4);font-size:14px;font-weight:600;color:var(--text);transition:background 0.15s;width:100%;text-align:left;background:transparent}
.token-option:hover{background:var(--surface2)}
.token-option.on{color:var(--accent)}
.arrow-divider{display:flex;align-items:center;justify-content:center;margin:4px 0}
.arrow-btn{width:36px;height:36px;border-radius:var(--r4);background:var(--surface2);border:2px solid var(--surface);color:var(--text2);font-size:16px;display:flex;align-items:center;justify-content:center;transition:all 0.2s}
.arrow-btn:hover{border-color:var(--border2);color:var(--text)}
.recipient-box{background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2);padding:16px;margin-bottom:6px;transition:border-color 0.2s}
.recipient-box:focus-within{border-color:rgba(34,197,240,0.3)}
.recipient-label{font-size:12px;color:var(--text2);margin-bottom:8px;font-weight:500}
.recipient-input{width:100%;background:transparent;color:var(--text);font-size:14px;font-family:var(--mono)}
.recipient-input::placeholder{color:var(--text3);font-family:var(--sans)}
.denom-box{background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2);padding:14px;margin-bottom:6px}
.denom-label{font-size:12px;color:var(--text2);margin-bottom:10px;font-weight:500}
.denom-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.denom-btn{padding:9px 6px;border:1px solid var(--border);border-radius:var(--r4);background:transparent;color:var(--text2);font-size:12px;font-family:var(--mono);font-weight:500;transition:all 0.2s}
.denom-btn:hover{border-color:var(--border2);color:var(--text)}
.denom-btn.on{background:var(--accent-dim);border-color:rgba(34,197,240,0.25);color:var(--accent)}
.fee-row{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:var(--r4);background:var(--surface2);font-size:12px;color:var(--text2);margin-bottom:6px}
.fee-val{font-weight:600;font-family:var(--mono)}
.main-btn{width:100%;padding:16px;border-radius:var(--r2);background:var(--net-color,var(--accent));color:#08090d;font-size:16px;font-weight:700;transition:all 0.22s;box-shadow:0 0 28px var(--net-glow,var(--accent-glow));display:flex;align-items:center;justify-content:center;gap:8px;margin-top:6px}
.main-btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 4px 36px var(--net-glow,var(--accent-glow))}
.main-btn:disabled{opacity:0.4;cursor:not-allowed;transform:none}
.main-btn.ghost{background:transparent;border:1px solid var(--border2);color:var(--text2);box-shadow:none}
.main-btn.ghost:hover:not(:disabled){border-color:var(--accent);color:var(--accent);box-shadow:none}
.pipeline{background:var(--surface2);border:1px solid rgba(34,197,240,0.15);border-radius:var(--r2);padding:16px;margin-top:8px}
.pipeline-title{font-size:11px;color:var(--text2);font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px}
.pipeline-steps{display:flex;flex-direction:column;gap:8px}
.pipe-step{display:flex;align-items:center;gap:10px;font-size:13px}
.pipe-dot{width:22px;height:22px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px}
.pipe-dot.done{background:var(--green-dim);color:var(--green);border:1px solid rgba(52,211,153,0.3)}
.pipe-dot.now{background:var(--accent-dim);color:var(--accent);border:1px solid rgba(34,197,240,0.3);animation:ring 1.5s infinite}
.pipe-dot.wait{background:var(--surface);color:var(--text3);border:1px solid var(--border)}
.pipe-label{color:var(--text2)}
.pipe-label.now{color:var(--text)}
@keyframes ring{0%,100%{box-shadow:0 0 0 0 rgba(34,197,240,0.3)}50%{box-shadow:0 0 0 4px rgba(34,197,240,0)}}
.funds-alert{background:linear-gradient(135deg,rgba(34,197,240,0.08),rgba(34,197,240,0.04));border:1px solid rgba(34,197,240,0.2);border-radius:var(--r2);padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.funds-alert-text{font-size:13px;color:var(--accent2)}
.funds-alert-text strong{display:block;font-size:15px;font-weight:700;color:var(--text);margin-bottom:2px}
.funds-alert-btn{padding:8px 14px;border-radius:var(--r4);background:var(--accent);color:#08090d;font-size:12px;font-weight:700;white-space:nowrap;transition:all 0.2s;flex-shrink:0}
.funds-alert-btn:hover{opacity:0.9}
.bottom-nav{display:flex;gap:6px;margin-bottom:16px}
.nav-tab{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 8px;border-radius:var(--r3);background:var(--surface2);border:1px solid var(--border);color:var(--text3);font-size:13px;font-weight:500;transition:all 0.2s}
.nav-tab:hover{border-color:var(--border2);color:var(--text2)}
.nav-tab.active{background:var(--accent-dim);border-color:rgba(34,197,240,0.25);color:var(--accent)}
.nav-tab-icon{font-size:15px;line-height:1}
.nav-tab-dot{display:none}
.modal-bg{position:fixed;inset:0;z-index:50;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px)}
@media(min-width:600px){.modal-bg{align-items:center}.modal{border-radius:var(--r)!important;max-height:90vh!important}}
.modal{width:100%;max-width:480px;background:var(--surface);border:1px solid var(--border2);border-radius:var(--r) var(--r) 0 0;max-height:92vh;overflow-y:auto;animation:slide-up 0.3s cubic-bezier(0.34,1.56,0.64,1)}
@keyframes slide-up{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
.modal-handle{width:36px;height:4px;border-radius:2px;background:var(--border2);margin:12px auto 0}
.modal-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)}
.modal-title{font-size:16px;font-weight:600;color:var(--text)}
.modal-close{width:30px;height:30px;border-radius:50%;background:var(--surface2);color:var(--text2);font-size:16px;display:flex;align-items:center;justify-content:center;transition:all 0.2s}
.modal-close:hover{background:var(--surface3);color:var(--text)}
.modal-body{padding:20px}
.hist-empty{text-align:center;padding:40px 20px;color:var(--text3);font-size:13px}
.hist-empty-icon{font-size:36px;opacity:0.3;margin-bottom:10px}
.hist-item{display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--border)}
.hist-item:last-child{border-bottom:none}
.hist-ico{width:36px;height:36px;border-radius:50%;background:var(--accent-dim);border:1px solid rgba(34,197,240,0.15);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--accent);flex-shrink:0}
.hist-body{flex:1;min-width:0}
.hist-amount{font-size:14px;font-weight:600;color:var(--text)}
.hist-dest{font-size:11px;color:var(--text3);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.hist-link{font-size:11px;color:var(--accent);display:block;margin-top:2px}
.hist-badge{font-size:10px;padding:3px 8px;border-radius:20px;flex-shrink:0}
.badge-ok{background:var(--green-dim);color:var(--green);border:1px solid rgba(52,211,153,0.2)}
.badge-pend{background:var(--accent-dim);color:var(--accent);border:1px solid rgba(34,197,240,0.2)}
.receive-addr{background:var(--surface2);border:1px solid rgba(34,197,240,0.2);border-radius:var(--r2);padding:16px;margin-bottom:16px}
.receive-addr-label{font-size:11px;color:var(--text2);font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px}
.receive-addr-val{font-family:var(--mono);font-size:11px;color:var(--accent2);word-break:break-all;line-height:1.6;margin-bottom:12px}
.copy-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:10px;border-radius:var(--r4);border:1px solid rgba(34,197,240,0.3);background:var(--accent-dim);color:var(--accent);font-size:13px;font-weight:600;transition:all 0.2s;cursor:pointer}
.copy-btn:hover{background:var(--accent);color:#08090d}
.copy-btn.ok{background:var(--green-dim);border-color:rgba(52,211,153,0.3);color:var(--green)}
.key-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;border-radius:var(--r4);background:var(--surface2);border:1px solid var(--border);margin-bottom:8px}
.key-label{font-size:12px;color:var(--text2);font-weight:500;white-space:nowrap}
.key-val{font-family:var(--mono);font-size:11px;color:var(--text2);filter:blur(5px);transition:filter 0.2s;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;text-align:right}
.key-val:hover{filter:none}
.paylink-box{margin-top:4px;padding:14px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2)}
.paylink-label{font-size:11px;color:var(--text2);font-weight:600;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px}
.paylink-url{font-family:var(--mono);font-size:10px;color:var(--text3);word-break:break-all;line-height:1.5;margin-bottom:10px}
.action-row{display:flex;gap:8px;margin-top:12px}
.action-btn{flex:1;padding:9px;border:1px solid var(--border2);border-radius:var(--r4);background:transparent;color:var(--text2);font-size:12px;font-weight:500;transition:all 0.2s;cursor:pointer}
.action-btn:hover{border-color:var(--accent);color:var(--accent)}
.no-keys{text-align:center;padding:32px 20px}
.no-keys-icon{font-size:44px;margin-bottom:14px;opacity:0.4}
.no-keys-title{font-size:16px;font-weight:600;color:var(--text);margin-bottom:6px}
.no-keys-desc{font-size:13px;color:var(--text2);margin-bottom:20px;line-height:1.6}
.scan-hero{text-align:center;padding:20px 0 24px}
.scan-icon{font-size:52px;margin-bottom:12px}
.scan-title{font-size:18px;font-weight:700;color:var(--text);margin-bottom:6px}
.scan-sub{font-size:13px;color:var(--text2)}
.scan-result{background:var(--surface2);border:1px solid rgba(52,211,153,0.2);border-radius:var(--r2);padding:16px;margin-top:14px}
.scan-result-hdr{font-size:12px;color:var(--green);font-weight:600;margin-bottom:12px}
.scan-item{padding:12px 0;border-bottom:1px solid var(--border)}
.scan-item:last-child{border-bottom:none}
.scan-item-amount{font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px}
.scan-item-addr{font-family:var(--mono);font-size:11px;color:var(--text3)}
.scan-item-link{font-size:11px;color:var(--accent);margin-top:4px;display:block}
.scan-withdraw-btn{width:100%;margin-top:10px;padding:10px;border-radius:var(--r4);background:var(--accent);color:#08090d;font-size:13px;font-weight:700;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:6px}
.scan-withdraw-btn:hover:not(:disabled){opacity:0.9}
.scan-withdraw-btn:disabled{opacity:0.4;cursor:not-allowed}
.alert{padding:12px 16px;border-radius:var(--r4);font-size:13px;margin-bottom:10px;line-height:1.5}
.alert-err{background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.15);color:#f87171}
.alert-ok{background:var(--green-dim);border:1px solid rgba(52,211,153,0.15);color:var(--green)}
.alert-info{background:var(--accent-dim);border:1px solid rgba(34,197,240,0.15);color:var(--accent2)}
.alert-warn{background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.15);color:#fbbf24}
.form-field{margin-bottom:14px}
.form-label{font-size:12px;color:var(--text2);font-weight:500;display:block;margin-bottom:6px}
.form-input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r4);padding:10px 14px;color:var(--text);font-size:14px;transition:border-color 0.2s}
.form-input:focus{border-color:rgba(34,197,240,0.4);outline:none}
.form-actions{display:flex;gap:10px;margin-top:16px}
.btn-cancel{flex:1;padding:10px;border-radius:var(--r4);background:var(--surface2);border:1px solid var(--border);color:var(--text2);font-size:13px;font-weight:500;cursor:pointer;transition:all 0.2s}
.btn-cancel:hover{border-color:var(--border2);color:var(--text)}
.btn-confirm{flex:1;padding:10px;border-radius:var(--r4);background:var(--accent);color:#08090d;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.2s}
.btn-confirm:hover{opacity:0.9}
.spin{width:16px;height:16px;border:2px solid rgba(8,9,13,0.25);border-top-color:#08090d;border-radius:50%;animation:spinning 0.65s linear infinite;display:inline-block;flex-shrink:0}
.spin-blue{border-color:rgba(34,197,240,0.2);border-top-color:var(--accent)}
@keyframes spinning{to{transform:rotate(360deg)}}
.divider-label{text-align:center;font-size:11px;color:var(--text3);position:relative;margin:16px 0}
.divider-label::before,.divider-label::after{content:'';position:absolute;top:50%;width:calc(50% - 20px);height:1px;background:var(--border)}
.divider-label::before{left:0}
.divider-label::after{right:0}
.rel{position:relative}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.fade{animation:fadeUp 0.3s ease both}
`;

export default function App() {
  const [lang, setLang]             = useState("pt");
  const t = T[lang];
  const [networkKey, setNetworkKey] = useState("base");
  const network = NETWORKS[networkKey];
  const CONTRACT_ADDRESS = network.contractAddress;
  const BACKEND_URL = network.backendUrl;
  const TOKENS = network.tokens;
  const DENOMS = Object.fromEntries(Object.keys(network.tokens).map(k => [k, DENOMS_BY_TOKEN[k] || [10, 50, 100, 500, 1000]]));
  const [account, setAccount]       = useState("");
  const [brlRate, setBrlRate]       = useState(null); // USD to BRL rate
  const [loading, setLoading]       = useState(false);
  const [token, setToken]           = useState("USDC");
  const [amount, setAmount]         = useState("");
  const [recipient, setRecipient]   = useState("");
  const [useFixed, setUseFixed]     = useState(false);
  const [useLock, setUseLock]       = useState(false);
  const [selDenom, setSelDenom]     = useState(null);
  const [recipientAmt, setRecipientAmt] = useState(""); // what recipient gets
  const [showTokens, setShowTokens] = useState(false);
  const [pipelineId, setPipelineId] = useState(null);
  const [pipeData, setPipeData]     = useState(null);
  const [alert, setAlert]           = useState(null);
  const [history, setHistory]       = useState([]);
  const [sk, setSk]                 = useState("");
  const [vk, setVk]                 = useState("");
  const [meta, setMeta]             = useState("");
  const [payLink, setPayLink]       = useState("");
  const [copied, setCopied]         = useState("");
  const [scanResults, setScanResults] = useState([]);
  const [scanning, setScanning]     = useState(false);
  const [withdrawingId, setWithdrawingId] = useState(null);
  const [modal, setModal]           = useState(null);
  const [exportPwd, setExportPwd]   = useState("");
  const [importData, setImportData] = useState("");
  const [importPwd, setImportPwd]   = useState("");
  const tokenRef = useRef(null);

  useEffect(() => {
    // Fetch USD/BRL rate
    fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL")
      .then(r => r.json())
      .then(d => setBrlRate(parseFloat(d.USDBRL?.bid) || 5.7))
      .catch(() => setBrlRate(5.7));
  }, []);

  useEffect(() => {
    const s = localStorage.getItem("sf_sk");
    const v = localStorage.getItem("sf_vk");
    if (s && v) { setSk(s); setVk(v); buildMeta(s,v); }
    const h = localStorage.getItem("sf_hist");
    if (h) setHistory(JSON.parse(h));
  }, []);

  useEffect(() => {
    const m = window.location.pathname.match(/\/p\/(st:.+)/);
    if (m) setRecipient(decodeURIComponent(m[1]));
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (tokenRef.current && !tokenRef.current.contains(e.target)) setShowTokens(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!pipelineId) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(BACKEND_URL + "/status/" + pipelineId);
        const d = await r.json();
        setPipeData(d);
        if (d.status === "completo" || d.concluido) {
          clearInterval(iv);
          setPipelineId(null);
          showAlert(t.txDone, "ok");
          // Update history status to done
          setHistory(prev => {
            const updated = prev.map((h, i) => i === 0 ? {...h, status:"done"} : h);
            localStorage.setItem("sf_hist", JSON.stringify(updated));
            return updated;
          });
        }
      } catch {}
    }, 5000);
    const to = setTimeout(() => clearInterval(iv), 20*60*1000);
    return () => { clearInterval(iv); clearTimeout(to); };
  }, [pipelineId, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildMeta(s, v) {
    try {
      const sp = ethers.SigningKey.computePublicKey(s, true);
      const vp = ethers.SigningKey.computePublicKey(v, true);
      const m  = "st:" + sp + ":" + vp;
      setMeta(m);
      setPayLink(window.location.origin + "/p/" + encodeURIComponent(m));
    } catch {}
  }

  function generateKeys() {
    const sw = ethers.Wallet.createRandom();
    const vw = ethers.Wallet.createRandom();
    setSk(sw.privateKey); setVk(vw.privateKey);
    localStorage.setItem("sf_sk", sw.privateKey);
    localStorage.setItem("sf_vk", vw.privateKey);
    buildMeta(sw.privateKey, vw.privateKey);
  }

  function saveHistory(e) {
    const u = [e, ...history].slice(0,50);
    setHistory(u);
    localStorage.setItem("sf_hist", JSON.stringify(u));
  }

  function showAlert(msg, type) {
    setAlert({msg, type: type || "info"});
    setTimeout(() => setAlert(null), 5000);
  }

  function copyText(text, key) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  }

  async function connect() {
    if (!window.ethereum) return;
    setLoading(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== network.chainId) {
        try { await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{chainId:network.chainHex}] }); }
        catch { showAlert(t.wrongNet,"err"); setLoading(false); return; }
      }
      const accs = await provider.send("eth_requestAccounts",[]);
      setAccount(accs[0]);
    } catch(e) { showAlert(e.message,"err"); }
    setLoading(false);
  }

  function getTier() {
    const v = useFixed ? (selDenom||0) : (parseFloat(amount)||0);
    const usd = token==="ETH" ? v*2200 : v;
    return getTierInfo(usd);
  }

  async function send() {
    if (!account) return connect();
    // If recipient amount is set, calculate gross amount to send
    const recAmt = parseFloat(recipientAmt)||0;
    let val;
    if (recAmt > 0) {
      const usd = token==="ETH"||token==="BNB"||token==="POL" ? recAmt*2200 : recAmt;
      const tier = getTierInfo(usd);
      val = recAmt / (1 - tier.bps/10000);
    } else {
      val = useFixed ? selDenom : parseFloat(amount);
    }
    if (!val||val<=0) return showAlert(t.enterAmount,"err");
    if (!recipient.trim()) return showAlert(t.enterTo,"err");

    // Minimum value check
    const minUsd = networkKey==="polygon" ? 10 : 25;
    const checkVal = recAmt > 0 ? recAmt : val;
    const valUsd = token==="ETH"||token==="BNB"||token==="POL" ? checkVal*2200 : checkVal;
    if (valUsd < minUsd) return showAlert(lang==="pt" ? "Valor minimo: $" + minUsd + " (R$ " + (minUsd*(brlRate||5.7)).toFixed(0) + ")" : "Minimum amount: $" + minUsd, "err");
    setLoading(true); setPipeData(null);
    try {
      let stealthAddress, ephemeralPubKey, viewTag;
      const recip = recipient.trim();
      if (recip.startsWith("st:")) {
        const clean = recip.replace("st:","");
        const idx = clean.indexOf(":",4);
        const sPub = clean.substring(0,idx);
        const vPub = clean.substring(idx+1);
        const ew = ethers.Wallet.createRandom();
        ephemeralPubKey = ethers.SigningKey.computePublicKey(ew.privateKey,true);
        const h = ethers.keccak256(ethers.concat([ethers.getBytes(ephemeralPubKey),ethers.getBytes(vPub)]));
        const seed = ethers.keccak256(ethers.concat([ethers.getBytes(h),ethers.getBytes(sPub)]));
        stealthAddress = new ethers.Wallet(seed).address;
        viewTag = parseInt(h.slice(2,4),16);
      } else {
        stealthAddress = recip;
        ephemeralPubKey = ethers.hexlify(ethers.randomBytes(33));
        viewTag = 0;
      }
      const params = new URLSearchParams({ token, stealthAddress, ephemeralPubKey, viewTag:String(viewTag), timelocked:String(useLock) });
      const er = await fetch(BACKEND_URL + "/entrada?" + params);
      const ed = await er.json();
      if (ed.erro) throw new Error(ed.erro);
      if (!ed.entradaAddress) throw new Error("Backend error.");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const decimals = TOKENS[token].decimals;
      const valBig = ethers.parseUnits(val.toFixed(decimals > 6 ? 8 : 6), decimals);
      let txHash;
      if (token==="ETH") {
        const tx = await signer.sendTransaction({ to:ed.entradaAddress, value:valBig });
        await tx.wait(); txHash = tx.hash;
      } else {
        const tc = new ethers.Contract(TOKENS[token].address, ERC20_ABI, signer);
        const allow = await tc.allowance(account, ed.entradaAddress);
        if (allow < valBig) { const a = await tc.approve(ed.entradaAddress,valBig); await a.wait(); }
        const erc = new ethers.Contract(TOKENS[token].address, ERC20_ABI, signer);
        const tx = await erc.transfer(ed.entradaAddress, valBig);
        await tx.wait(); txHash = tx.hash;
      }
      saveHistory({ hash:txHash, token, amount:val, to:recip, ts:Date.now(), status:"pending" });
      showAlert(t.sent,"info");
      setAmount(""); setSelDenom(null);
      try {
        const ar = await fetch(BACKEND_URL + "/aguardar/" + ed.entradaAddress);
        const ad = await ar.json();
        if (ad.pipelineId || ad.id) setPipelineId(ad.pipelineId || ad.id);
      } catch {}
    } catch(e) { showAlert(e.message||"Erro.","err"); }
    setLoading(false);
  }

  async function scan() {
    if (!sk||!vk) return showAlert(t.noKeysForScan,"warn");
    setScanning(true); setScanResults([]);
    try {
      const provider = new ethers.JsonRpcProvider(network.rpc);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
      const filter = contract.filters.StealthDeposit();
      const current = await provider.getBlockNumber();
      const CHUNK = 9000; const TOTAL = 36000;
      const from = Math.max(0, current-TOTAL);
      const found = [];
      for (let s2=from; s2<current; s2+=CHUNK) {
        const end = Math.min(s2+CHUNK-1,current);
        try {
          const evs = await contract.queryFilter(filter,s2,end);
          for (const ev of evs) {
            const args = ev.args;
            const res = tryDecrypt(args[0],args[1],Number(args[4]),sk,vk);
            if (res) {
              const tAddr = args[2];
              const amt = args[3];
              const tl = args[5];
              const ua = args[6];
              const sym = Object.keys(TOKENS).find(k=>TOKENS[k].address.toLowerCase()===tAddr.toLowerCase())||"?";
              const dec = TOKENS[sym] ? TOKENS[sym].decimals : 18;
              found.push({ stealthAddress:res.stealthAddress, stealthPrivKey:res.stealthPrivKey, token:sym, tokenAddr:tAddr, amount:ethers.formatUnits(amt,dec), timelocked:tl, unlockAt:Number(ua), txHash:ev.transactionHash });
            }
          }
        } catch {}
      }
      setScanResults(found);
      if (!found.length) showAlert(t.noFound,"info");
    } catch(e) { showAlert(e.message,"err"); }
    setScanning(false);
  }

  async function doWithdraw(item) {
    if (!account) return connect();
    setWithdrawingId(item.stealthAddress);
    try {
      const sw = new ethers.Wallet(item.stealthPrivKey);
      const provider = new ethers.JsonRpcProvider(network.rpc);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
      const nonce = await contract.withdrawNonces(item.stealthAddress);
      const packed = ethers.keccak256(ethers.solidityPacked(["address","address","address","uint256","uint256"],[item.stealthAddress,item.tokenAddr,account,nonce,BigInt(network.chainId)]));
      const sig = await sw.signMessage(ethers.getBytes(packed));
      const res = await fetch(network.backendUrl + "/withdraw",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stealthAddress:item.stealthAddress,token:item.tokenAddr,recipient:account,sig})});
      const d = await res.json();
      if (d.ok) {
        showAlert(t.withdrawDone,"ok");
        setScanResults(prev=>prev.filter(r=>r.stealthAddress!==item.stealthAddress));
      } else showAlert(d.error||"Erro.","err");
    } catch(e) { showAlert(e.message,"err"); }
    setWithdrawingId(null);
  }

  async function handleExport() {
    if (!exportPwd) return;
    const enc = await encryptKeys({sk,vk}, exportPwd);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([enc],{type:"text/plain"}));
    a.download = "silentflow-backup.enc"; a.click();
    setModal(null); setExportPwd("");
  }

  async function handleImport() {
    if (!importData||!importPwd) return;
    try {
      const keys = await decryptKeys(importData.trim(),importPwd);
      setSk(keys.sk); setVk(keys.vk);
      localStorage.setItem("sf_sk",keys.sk); localStorage.setItem("sf_vk",keys.vk);
      buildMeta(keys.sk,keys.vk);
      setImportData(""); setImportPwd("");
      showAlert(t.importDone,"ok");
      setModal("receive");
    } catch { showAlert(t.wrongPwd,"err"); }
  }

  const pipeSteps = [t.pipe1,t.pipe2,t.pipe3,t.pipe4];
  const pipeOrder = ["recebido","splitting","hops","completo"];
  function pipeStatus(i) {
    if (!pipeData) return "wait";
    const ci = pipeOrder.indexOf(pipeData.status);
    if (i<ci) return "done";
    if (i===ci) return "now";
    return "wait";
  }

  const tier = getTier();
  const hasAmount = useFixed ? !!selDenom : !!(parseFloat(amount)>0);
  const usdVal = (() => {
    const v = useFixed ? (selDenom||0) : (parseFloat(amount)||0);
    if (!v) return null;
    const usd = token==="ETH"||token==="BNB"||token==="POL" ? v*2200 : v;
    const brl = brlRate ? (usd * brlRate).toFixed(2) : null;
    const brlStr = brl ? " · R$ " + Number(brl).toLocaleString("pt-BR",{minimumFractionDigits:2}) : "";
    return "≈ $" + usd.toFixed(2) + brlStr;
  })();

  // Calculate sender amount from recipient amount
  const senderCalc = (() => {
    const v = parseFloat(recipientAmt)||0;
    if (!v) return null;
    const usd = token==="ETH"||token==="BNB"||token==="POL" ? v*2200 : v;
    const tier = getTierInfo(usd);
    const send = v / (1 - tier.bps/10000);
    const sendBrl = brlRate ? (send * (token==="ETH"||token==="BNB"||token==="POL"?2200:1) * brlRate) : null;
    return {
      val: send.toFixed(token==="ETH"||token==="BNB"||token==="POL"?5:2),
      brl: sendBrl ? "R$ " + sendBrl.toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2}) : null
    };
  })();

  const closeModal = () => setModal(null);

  return (
    <>
      <style>{S}</style>
      <div className="glow" />
      <div className="app">

        <nav className="nav">
          <div className="nav-brand">
            <img className="nav-logo" src="/logo.png" alt="SF" onError={e=>{e.target.style.display="none";}} />
            <span className="nav-name">SILENTFLOW</span>
            <span className="nav-badge">
              {networkKey === "base" ? "BASE" : "POLYGON"}
            </span>
          </div>
          <div className="nav-right">
            <a href="https://silentflow-landing-wine.vercel.app" target="_blank" rel="noreferrer" style={{fontSize:12,color:"var(--text2)",padding:"5px 10px",border:"1px solid var(--border2)",borderRadius:20,transition:"all 0.2s",textDecoration:"none"}}>
              {lang==="pt"?"Sobre":"About"}
            </a>
            <button className="nav-lang" onClick={()=>setLang(l=>l==="pt"?"en":"pt")}>{lang==="pt"?"EN":"PT"}</button>
            {account
              ? <div className="nav-wallet" onClick={()=>setModal("history")}><span className="wallet-dot"/>{fmtAddr(account)}</div>
              : <button className="nav-connect" onClick={connect} disabled={loading}>{loading?t.connecting:t.connectBtn}</button>
            }
          </div>
        </nav>

        <div className="main">
          <div className="card-wrap">

            <div className="bottom-nav">
              {[
                {key:"send",    icon:"↗", label:t.send,    action:closeModal},
                {key:"receive", icon:"⬇", label:t.receive, action:()=>setModal("receive")},
                {key:"scan",    icon:"⬡", label:t.scan,    action:()=>{ setModal("scan"); if(sk&&vk&&!scanResults.length) scan(); }},
                {key:"history", icon:"📋", label:t.history, action:()=>setModal("history")},
              ].map(({key,icon,label,action})=>(
                <button key={key} className={"nav-tab" + (modal===key||(modal===null&&key==="send")?" active":"")} onClick={action}>
                  <span className="nav-tab-icon">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {alert && <div className={"alert alert-" + alert.type + " fade"} style={{marginBottom:12}}>{alert.msg}</div>}

            {scanResults.length>0 && !modal && (
              <div className="funds-alert fade" style={{marginBottom:12}}>
                <div className="funds-alert-text">
                  <strong>{t.fundsFound}</strong>
                  {scanResults.length} {t.fundsFoundDesc}
                </div>
                <button className="funds-alert-btn" onClick={()=>setModal("scan")}>{t.sacar} →</button>
              </div>
            )}

            <div className="swap-card fade">
              <div className="card-header">
                <span className="card-title">{t.sendTitle}</span>
                <div className="card-settings">
                  <button className={"settings-btn" + (useFixed?" on":"")} onClick={()=>{setUseFixed(f=>!f);setSelDenom(null);setAmount("");}}>
                    {t.fixedDenom}
                  </button>
                  <button className={"settings-btn" + (useLock?" on":"")} onClick={()=>setUseLock(l=>!l)}>
                    {t.timelock}
                  </button>
                </div>
              </div>
              {/* NETWORK SELECTOR */}
              <div style={{display:"flex",gap:6,marginBottom:16,background:"var(--surface2)",padding:4,borderRadius:12,border:"1px solid var(--border)"}}>
                {[
                  {key:"base", label:"Base", color:"#22c5f0", svg:<img src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png" width="16" height="16" style={{borderRadius:"50%"}} alt="Base"/>},
                  {key:"polygon", label:"Polygon", color:"#8247e5", svg:<img src="https://assets.coingecko.com/coins/images/4713/small/polygon.png" width="16" height="16" style={{borderRadius:"50%"}} alt="Polygon"/>},
                  {key:"bnb", label:"BNB", color:"#F0B90B", svg:<img src="https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" width="16" height="16" style={{borderRadius:"50%"}} alt="BNB"/>},
                ].map(({key, label, color, svg})=>(
                  <button key={key}
                    onClick={()=>{ setNetworkKey(key); setToken("USDC"); setSelDenom(null); setAmount(""); setScanResults([]); }}
                    style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:7,
                      padding:"9px 12px",borderRadius:9,border:"none",cursor:"pointer",
                      transition:"all 0.2s",fontWeight:600,fontSize:13,fontFamily:"var(--sans)",
                      background: networkKey===key ? color : "transparent",
                      color: networkKey===key ? (key==="base"?"#08090d":"#fff") : "var(--text2)",
                      boxShadow: networkKey===key ? ("0 0 16px " + color + "55") : "none"
                    }}>
                    {svg}
                    {label}
                    {networkKey===key && <span style={{fontSize:10,opacity:0.7}}>✓</span>}
                  </button>
                ))}
              </div>

              {(useFixed||useLock) && (
                <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
                  {useFixed && (
                    <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--accent)",background:"var(--accent-dim)",border:"1px solid rgba(34,197,240,0.15)",padding:"4px 10px",borderRadius:20}}>
                      ✓ {lang==="pt"?"Valor padronizado ativo — maior controle sobre seus dados financeiros":"Fixed amount active — greater control over your financial data"}
                    </div>
                  )}
                  {useLock && (
                    <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--amber)",background:"rgba(251,191,36,0.06)",border:"1px solid rgba(251,191,36,0.15)",padding:"4px 10px",borderRadius:20}}>
                      ✓ {lang==="pt"?"Atraso de 6h ativo — processamento em janela coletiva para mais privacidade":"6h delay active — processed in a collective window for enhanced privacy"}
                    </div>
                  )}
                </div>
              )}

              {useFixed ? (
                <div className="denom-box">
                  <div className="denom-label">{t.amount}</div>
                  <div className="denom-grid">
                    {DENOMS[token].map(d=>(
                      <button key={d} className={"denom-btn" + (selDenom===d?" on":"")} onClick={()=>setSelDenom(d)}>
                        {d} {token}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="amount-box">
                  <div className="amount-label">{t.amount}</div>
                  <div className="amount-row">
                    <input className="amount-input" type="number" placeholder="0" value={amount} onChange={e=>setAmount(e.target.value)} step="any" min="0"/>
                    <div className="rel" ref={tokenRef}>
                      <button className="token-select" onClick={()=>setShowTokens(s=>!s)}>
                        <span style={{display:"flex",alignItems:"center",flexShrink:0}}>{TOKEN_ICONS[token]}</span>
                        {token}
                        <span className="token-chevron">▾</span>
                      </button>
                      {showTokens && (
                        <div className="token-dropdown">
                          {["USDC","USDT",...Object.keys(TOKENS).filter(k=>k!=="USDC"&&k!=="USDT")].map(tk=>(
                            <button key={tk} className={"token-option" + (token===tk?" on":"")} onClick={()=>{setToken(tk);setShowTokens(false);setAmount("");setSelDenom(null);}}>
                              <span style={{display:"flex",alignItems:"center",flexShrink:0}}>{TOKEN_ICONS[tk]}</span>
                              {tk}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {usdVal && <div className="amount-usd">{usdVal}</div>}
                </div>
              )}

              {/* RECIPIENT AMOUNT BOX */}
              <div className="amount-box" style={{marginBottom:6}}>
                <div className="amount-label">{lang==="pt"?"Destinatário recebe":"Recipient gets"}</div>
                <div className="amount-row">
                  <input
                    className="amount-input"
                    type="number" placeholder="0"
                    value={recipientAmt}
                    onChange={e=>{
                      setRecipientAmt(e.target.value);
                      // Clear sender amount when typing recipient amount
                      if(e.target.value) setAmount("");
                    }}
                    step="any" min="0"
                  />
                  <div style={{fontSize:13,fontWeight:600,color:"var(--text2)",fontFamily:"var(--mono)",flexShrink:0,padding:"8px 14px",background:"var(--surface3)",border:"1px solid var(--border2)",borderRadius:20}}>
                    {token}
                  </div>
                </div>
                {senderCalc && (
                  <div className="amount-usd">
                    {lang==="pt"?"→ Você envia ":"→ You send "}{senderCalc.val} {token}
                    {senderCalc.brl ? " (" + senderCalc.brl + ")" : ""}
                  </div>
                )}
              </div>

              <div className="arrow-divider">
                <button className="arrow-btn">↓</button>
              </div>

              <div className="recipient-box">
                <div className="recipient-label">{t.to}</div>
                <input className="recipient-input" placeholder={t.toPlaceholder} value={recipient} onChange={e=>setRecipient(e.target.value)}/>
              </div>

              {hasAmount && (
                <div className="fee-row" style={{marginTop:6}}>
                  <span>{t.fee}</span>
                  <span className="fee-val" style={{color:tier.color}}>{tier.bps/100}% · {tier.label}</span>
                </div>
              )}

              <button className="main-btn" onClick={send} disabled={loading}
                style={{marginTop:8, background: network.color, boxShadow: "0 0 28px " + network.color + "44"}}>
                {loading ? <><span className="spin"/>{t.sending}</> : ("→ " + t.sendBtn)}
              </button>
              <button className="main-btn ghost" onClick={()=>{ if(!sk){generateKeys();} setModal("receive"); }}
                style={{marginTop:8}}>
                ⬇ {lang==="pt" ? "Gerar link para receber" : "Generate payment link"}
              </button>

              {pipeData && (
                <div className="pipeline fade">
                  <div className="pipeline-title">Pipeline de privacidade</div>
                  <div className="pipeline-steps">
                    {pipeSteps.map((label,i)=>{
                      const s = pipeStatus(i);
                      return (
                        <div key={i} className="pipe-step">
                          <div className={"pipe-dot " + s}>{s==="done"?"✓":s==="now"?"◉":"○"}</div>
                          <span className={"pipe-label" + (s==="now"?" now":"")}>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>



        {modal==="history" && (
          <div className="modal-bg" onClick={closeModal}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="modal-handle"/>
              <div className="modal-header">
                <span className="modal-title">{t.history}</span>
                <button className="modal-close" onClick={closeModal}>✕</button>
              </div>
              <div className="modal-body">
                {history.length===0 ? (
                  <div className="hist-empty">
                    <div className="hist-empty-icon">↗</div>
                    <div style={{fontWeight:600,marginBottom:4}}>{t.noHistory}</div>
                    <div>{t.noHistoryDesc}</div>
                  </div>
                ) : history.map((h,i)=>(
                  <div key={i} className="hist-item">
                    <div className="hist-ico">{h.token ? h.token.slice(0,1) : "E"}</div>
                    <div className="hist-body">
                      <div className="hist-amount">{h.amount} {h.token}</div>
                      <div className="hist-dest">{h.to ? h.to.slice(0,30) : ""}...</div>
                      <a className="hist-link" href={network.explorer + "/tx/" + h.hash} target="_blank" rel="noreferrer">{t.basescan} ↗</a>
                    </div>
                    <span className={"hist-badge " + (h.status==="done"?"badge-ok":"badge-pend")}>
                      {h.status==="done"?"✓":"..."}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {modal==="receive" && (
          <div className="modal-bg" onClick={closeModal}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="modal-handle"/>
              <div className="modal-header">
                <span className="modal-title">{t.receiveTitle}</span>
                <button className="modal-close" onClick={closeModal}>✕</button>
              </div>
              <div className="modal-body">
                {!sk ? (
                  <div className="no-keys">
                    <div className="no-keys-icon">⬇</div>
                    <div className="no-keys-title">{t.noKeys}</div>
                    <div className="no-keys-desc">{t.noKeysDesc}</div>
                    <button className="main-btn" onClick={generateKeys} style={{maxWidth:260,margin:"0 auto"}}>{t.createKeys}</button>
                    <div className="divider-label" style={{marginTop:20}}>{t.or}</div>
                    <button className="main-btn ghost" onClick={()=>setModal("import")} style={{maxWidth:260,margin:"8px auto 0"}}>{t.importKeys}</button>
                  </div>
                ) : (
                  <>
                    <div className="receive-addr">
                      <div className="receive-addr-label">{t.yourAddress}</div>
                      <div className="receive-addr-val">{meta}</div>
                      <button className={"copy-btn" + (copied==="meta"?" ok":"")} onClick={()=>copyText(meta,"meta")}>
                        {copied==="meta" ? ("✓ " + t.copied) : t.copy}
                      </button>
                    </div>
                    <div className="key-row">
                      <span className="key-label">🔑 {t.spendKey}</span>
                      <span className="key-val">{sk}</span>
                    </div>
                    <div className="key-row">
                      <span className="key-label">👁 {t.viewKey}</span>
                      <span className="key-val">{vk}</span>
                    </div>
                    <div style={{fontSize:11,color:"var(--text3)",textAlign:"center",margin:"6px 0 12px"}}>{t.keysHint}</div>
                    <div className="paylink-box">
                      <div className="paylink-label">🔗 {t.paylink}</div>
                      {/* QR Code */}
                      <div style={{display:"flex",justifyContent:"center",margin:"12px 0"}}>
                        <img
                          src={"https://api.qrserver.com/v1/create-qr-code/?size=160x160&bgcolor=111520&color=22c5f0&data=" + encodeURIComponent(payLink)}
                          width="160" height="160"
                          style={{borderRadius:12,border:"1px solid rgba(34,197,240,0.2)"}}
                          alt="QR Code"
                        />
                      </div>
                      <div className="paylink-url">{payLink}</div>
                      <button className={"copy-btn" + (copied==="link"?" ok":"")} onClick={()=>copyText(payLink,"link")}>
                        {copied==="link" ? ("✓ " + t.copied) : t.copyLink}
                      </button>
                    </div>
                    <div className="action-row">
                      <button className="action-btn" onClick={()=>setModal("export")}>{t.exportKeys}</button>
                      <button className="action-btn" onClick={()=>setModal("import")}>{t.importKeys}</button>
                      <button className="action-btn" onClick={generateKeys}>{t.newKeys}</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {modal==="scan" && (
          <div className="modal-bg" onClick={closeModal}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="modal-handle"/>
              <div className="modal-header">
                <span className="modal-title">{t.scanTitle}</span>
                <button className="modal-close" onClick={closeModal}>✕</button>
              </div>
              <div className="modal-body">
                {!sk ? (
                  <div className="alert alert-warn">{t.noKeysForScan}</div>
                ) : (
                  <>
                    <div className="scan-hero">
                      <div className="scan-icon">⬡</div>
                      <div className="scan-title">{t.scanTitle}</div>
                      <div className="scan-sub">{t.scanDesc}</div>
                    </div>
                    <button className="main-btn" onClick={scan} disabled={scanning}>
                      {scanning ? <><span className="spin"/>{t.scanning}</> : t.scanBtn}
                    </button>
                    {!account && <div className="alert alert-info" style={{marginTop:10}}>{lang==="pt"?"Conecte sua carteira para sacar.":"Connect your wallet to withdraw."}</div>}
                    {scanResults.length>0 && (
                      <div className="scan-result">
                        <div className="scan-result-hdr">✓ {scanResults.length} {t.found}</div>
                        {scanResults.map((r,i)=>{
                          const isLocked = r.timelocked&&r.unlockAt>Date.now()/1000;
                          const isWd = withdrawingId===r.stealthAddress;
                          return (
                            <div key={i} className="scan-item">
                              <div className="scan-item-amount">{r.amount} {r.token}</div>
                              <div className="scan-item-addr">{fmtAddr(r.stealthAddress)}</div>
                              <div style={{fontSize:11,marginTop:4,color:isLocked?"var(--amber)":"var(--green)"}}>
                                {isLocked ? ("🔒 " + t.locked + ": " + new Date(r.unlockAt*1000).toLocaleString()) : ("✓ " + t.unlocked)}
                              </div>
                              <a className="scan-item-link" href={network.explorer + "/tx/" + r.txHash} target="_blank" rel="noreferrer">Basescan ↗</a>
                              <button className="scan-withdraw-btn" onClick={()=>doWithdraw(r)} disabled={isWd||isLocked||!account}>
                                {isWd ? <><span className="spin"/>{t.withdrawing}</> : ("→ " + t.withdrawBtn)}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {modal==="export" && (
          <div className="modal-bg" onClick={()=>setModal("receive")}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="modal-handle"/>
              <div className="modal-header">
                <span className="modal-title">{t.exportTitle}</span>
                <button className="modal-close" onClick={()=>setModal("receive")}>✕</button>
              </div>
              <div className="modal-body">
                <div className="form-field">
                  <label className="form-label">{t.password}</label>
                  <input className="form-input" type="password" placeholder="••••••••" value={exportPwd} onChange={e=>setExportPwd(e.target.value)}/>
                </div>
                <div className="form-actions">
                  <button className="btn-cancel" onClick={()=>setModal("receive")}>{t.cancel}</button>
                  <button className="btn-confirm" onClick={handleExport}>{t.confirm}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {modal==="import" && (
          <div className="modal-bg" onClick={()=>setModal("receive")}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="modal-handle"/>
              <div className="modal-header">
                <span className="modal-title">{t.importKeys}</span>
                <button className="modal-close" onClick={()=>setModal("receive")}>✕</button>
              </div>
              <div className="modal-body">
                <p style={{fontSize:13,color:"var(--text2)",marginBottom:16}}>{t.importDesc}</p>
                <div className="form-field">
                  <label className="form-label">{t.backupContent}</label>
                  <textarea className="form-input" rows={4} style={{resize:"vertical"}} placeholder={t.backupPaste} value={importData} onChange={e=>setImportData(e.target.value)}/>
                </div>
                <div className="form-field">
                  <label className="form-label">{t.password}</label>
                  <input className="form-input" type="password" placeholder="••••••••" value={importPwd} onChange={e=>setImportPwd(e.target.value)}/>
                </div>
                <div className="form-actions">
                  <button className="btn-cancel" onClick={()=>setModal("receive")}>{t.cancel}</button>
                  <button className="btn-confirm" onClick={handleImport}>{t.confirm}</button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  );
}
