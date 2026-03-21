/* eslint-disable no-undef */
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";

const CONTRACT_ADDRESS = "0x9ce1b8a2344BB1891A6Ed9b2aBb782fb1B8C18E9";
const BACKEND_URL = "https://silentflow-production.up.railway.app";

const ABI = [
  "function depositETH(address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external payable",
  "function depositETHTimelocked(address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external payable",
  "function depositToken(address token, uint256 amount, address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external",
  "function depositTokenTimelocked(address token, uint256 amount, address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external",
  "function withdraw(address token, address recipient) external",
  "function withdrawFor(address stealthAddress, address token, address recipient, bytes calldata sig) external",
  "function withdrawNonces(address) external view returns (uint256)",
  "function balanceOf(address stealthAddress, address token) external view returns (uint256)",
  "function isUnlocked(address stealthAddress, address token) external view returns (bool)",
  "function getUnlockTime(address stealthAddress, address token) external view returns (uint256)",
  "event StealthDeposit(bytes ephemeralPubKey, address indexed stealthAddress, address token, uint256 amount, uint8 viewTag, bool timelocked, uint256 unlockAt)",
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
  return { v: 1, salt: Array.from(salt), iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
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

function buildPayLink(metaAddress) {
  return `${window.location.origin}/p/${encodeURIComponent(metaAddress)}`;
}

function parsePayLink(href) {
  try {
    const url = new URL(href);
    const parts = url.pathname.split("/p/");
    if (parts[1]) return decodeURIComponent(parts[1]);
  } catch {}
  if (href.startsWith("st:")) return href;
  return null;
}

function classifyError(e) {
  const msg = (e?.reason || e?.message || e?.code || "").toLowerCase();
  if (msg.includes("user rejected") || msg.includes("user denied") || msg.includes("4001"))
    return { title: "Transacao cancelada", desc: "Voce recusou a transacao na carteira. Tudo bem — nenhum fundo foi movido.", action: null, type: "warn" };
  if (msg.includes("insufficient funds") || msg.includes("insufficient balance"))
    return { title: "Saldo insuficiente", desc: "Sua carteira nao tem ETH suficiente para cobrir o valor + gas.", action: "Verifique seu saldo e tente novamente.", type: "err" };
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed to fetch"))
    return { title: "Erro de conexao", desc: "Nao foi possivel conectar ao backend do SilentFlow.", action: "Verifique sua internet e tente novamente.", type: "err" };
  if (msg.includes("link de pagamento") || msg.includes("invalido"))
    return { title: "Link invalido", desc: "O link de pagamento nao foi reconhecido.", action: "Cole o link completo (silentflow.vercel.app/p/st:...) ou st:... diretamente.", type: "err" };
  if (msg.includes("replacement") || msg.includes("nonce") || msg.includes("underpriced"))
    return { title: "Erro de rede", desc: "Conflito de gas na blockchain.", action: "Aguarde 30 segundos e tente novamente.", type: "err" };
  if (msg.includes("timeout") || msg.includes("exceeds block gas"))
    return { title: "Transacao lenta", desc: "A rede esta congestionada.", action: "Tente novamente em alguns minutos.", type: "warn" };
  if (msg.includes("allowance") || msg.includes("approve") || msg.includes("transfer amount exceeds"))
    return { title: "Erro de aprovacao", desc: "Problema ao aprovar o token.", action: "Tente novamente — pode ser necessario re-aprovar na MetaMask.", type: "err" };
  return { title: "Algo deu errado", desc: e?.reason || e?.message || "Erro desconhecido.", action: "Tente novamente. Se persistir, verifique o console do navegador.", type: "err" };
}

/* ============================================================
   STYLE — Dark Elegant / Minimalist (Linear + Vercel inspired)
   ============================================================ */
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --bg: #09090b;
  --surface: #0f0f14;
  --surface2: #16161e;
  --surface3: #1c1c27;
  --border: rgba(255,255,255,.06);
  --border2: rgba(255,255,255,.10);
  --border3: rgba(255,255,255,.15);
  --accent: #22b8e6;
  --accent2: #38d0ff;
  --accent-dim: rgba(34,184,230,.10);
  --accent-glow: rgba(34,184,230,.20);
  --green: #34d399;
  --green-dim: rgba(52,211,153,.08);
  --green-border: rgba(52,211,153,.18);
  --amber: #fbbf24;
  --amber-dim: rgba(251,191,36,.06);
  --red: #f87171;
  --red-dim: rgba(248,113,113,.06);
  --text: #ededf0;
  --text2: rgba(237,237,240,.55);
  --text3: rgba(237,237,240,.28);
  --mono: 'JetBrains Mono', monospace;
  --sans: 'DM Sans', system-ui, -apple-system, sans-serif;
  --r: 14px;
  --r2: 10px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
html { scroll-behavior: smooth }

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Ambient glow */
.bg-glow {
  position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
}
.bg-glow::before {
  content: ''; position: absolute; width: 900px; height: 600px;
  top: -250px; left: 50%; transform: translateX(-50%);
  background: radial-gradient(ellipse, rgba(34,184,230,.06) 0%, transparent 65%);
}
.bg-glow::after {
  content: ''; position: absolute; width: 500px; height: 500px;
  bottom: -200px; right: -100px;
  background: radial-gradient(ellipse, rgba(34,184,230,.03) 0%, transparent 60%);
}

.wrap {
  position: relative; z-index: 1;
  max-width: 1060px; margin: 0 auto; padding: 0 24px 80px;
}

/* ---- HEADER ---- */
.hdr {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 0; border-bottom: 1px solid var(--border); margin-bottom: 36px;
}
.logo { display: flex; flex-direction: column; align-items: center; gap: 4px }
.logo img {
  height: 52px; width: auto; object-fit: contain;
  filter: drop-shadow(0 0 16px rgba(34,184,230,.35));
}
.logo-name {
  font-size: 11px; font-weight: 700; color: var(--accent);
  letter-spacing: 3px; text-transform: uppercase;
}
.hdr-right { display: flex; align-items: center; gap: 10px }
.net-badge {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 20px; font-size: 11px;
  font-weight: 600; letter-spacing: .5px;
  background: var(--green-dim); border: 1px solid var(--green-border); color: var(--green);
}
.net-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--green); box-shadow: 0 0 8px var(--green);
  animation: pulse-dot 2.5s ease-in-out infinite;
}
@keyframes pulse-dot { 0%,100%{ opacity: 1 } 50%{ opacity: .35 } }
.conn-btn {
  padding: 8px 18px; background: var(--surface2);
  border: 1px solid var(--border2); border-radius: 20px;
  color: var(--text2); font-family: var(--sans); font-size: 13px;
  font-weight: 500; cursor: pointer; transition: all .25s ease;
}
.conn-btn:hover { border-color: var(--accent); color: var(--text) }
.conn-btn.on {
  border-color: var(--green-border); color: var(--green);
  background: var(--green-dim);
}

/* ---- TABS ---- */
.tabs {
  display: flex; gap: 2px; margin-bottom: 32px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 4px; width: fit-content;
}
.tab {
  padding: 10px 32px; background: transparent; border: none;
  border-radius: 9px; color: var(--text3); font-family: var(--sans);
  font-size: 14px; font-weight: 500; cursor: pointer;
  transition: all .25s ease; position: relative;
}
.tab:hover { color: var(--text2) }
.tab.on {
  background: var(--surface2); color: var(--text);
  border: 1px solid var(--border2);
  box-shadow: 0 2px 10px rgba(0,0,0,.4);
}

/* ---- GRID ---- */
.grid { display: grid; grid-template-columns: 1fr 400px; gap: 24px; align-items: start }
.left { display: flex; flex-direction: column; gap: 16px }

/* ---- SECTION LABEL ---- */
.sec-label {
  font-size: 11px; font-weight: 600; color: var(--text3);
  letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 4px;
}

/* ---- CARDS ---- */
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r); overflow: hidden;
  transition: border-color .2s ease;
}
.card:hover { border-color: var(--border2) }
.card-body { padding: 6px 0 }

/* ---- HISTORY (send tab) ---- */
.hist-empty {
  text-align: center; padding: 24px 16px; color: var(--text3); font-size: 13px;
}
.hist-item {
  padding: 16px 20px; border-bottom: 1px solid var(--border);
  transition: background .2s ease;
  animation: fade-up .35s ease both;
}
.hist-item:hover { background: rgba(255,255,255,.015) }
.hist-item:last-child { border-bottom: none }
.hist-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px }
.hist-amt { font-size: 15px; font-weight: 600; color: var(--text) }
.hist-time { font-size: 11px; color: var(--text3); font-family: var(--mono) }
.hist-to { font-size: 12px; color: var(--text3); margin-bottom: 10px; font-family: var(--mono) }
.hist-foot { display: flex; align-items: center; justify-content: space-between }
.pill {
  font-size: 11px; padding: 4px 12px; border-radius: 20px; font-weight: 600;
  letter-spacing: .3px;
}
.pill.done { background: var(--green-dim); border: 1px solid var(--green-border); color: var(--green) }
.pill.proc { background: var(--accent-dim); border: 1px solid rgba(34,184,230,.2); color: var(--accent2) }
.hist-link {
  font-size: 11px; color: var(--text3); text-decoration: none;
  transition: color .2s; font-weight: 500;
}
.hist-link:hover { color: var(--accent2) }

/* ---- INFO ACCORDION ---- */
.info-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r); overflow: hidden;
}
.info-toggle {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; cursor: pointer; user-select: none;
  transition: background .2s;
}
.info-toggle:hover { background: rgba(255,255,255,.02) }
.info-label { font-size: 13px; color: var(--text2); font-weight: 500 }
.info-arrow { font-size: 10px; color: var(--text3); transition: transform .3s ease }
.info-arrow.open { transform: rotate(180deg) }
.info-body { max-height: 0; overflow: hidden; transition: max-height .4s ease, opacity .3s; opacity: 0 }
.info-body.open { max-height: 500px; opacity: 1 }
.info-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 11px 20px; border-top: 1px solid var(--border);
}
.info-k { font-size: 12px; color: var(--text3); font-weight: 500 }
.info-v { font-size: 12px; color: var(--text2); font-family: var(--mono) }

/* ---- FORM CARD (right side) ---- */
.form-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 18px; padding: 28px;
  position: sticky; top: 20px;
  transition: border-color .2s;
}
.form-card:hover { border-color: var(--border2) }
.form-title { font-size: 20px; font-weight: 700; color: var(--text); margin-bottom: 3px; letter-spacing: -.3px }
.form-sub { font-size: 13px; color: var(--text3); margin-bottom: 24px; font-weight: 400; line-height: 1.5 }

/* ---- TOKEN SELECTOR ---- */
.toks { display: flex; gap: 6px; margin-bottom: 20px }
.tok {
  flex: 1; padding: 9px 0; background: transparent;
  border: 1px solid var(--border); border-radius: var(--r2);
  color: var(--text3); font-family: var(--mono); font-size: 13px;
  font-weight: 500; cursor: pointer; transition: all .25s ease;
  text-align: center;
}
.tok:hover { border-color: var(--border2); color: var(--text2) }
.tok.on {
  background: var(--accent-dim); border-color: rgba(34,184,230,.35);
  color: var(--accent2); box-shadow: 0 0 12px rgba(34,184,230,.08);
}

/* ---- FORM FIELDS ---- */
.fld { margin-bottom: 16px }
.fld label {
  display: block; font-size: 11px; font-weight: 600; color: var(--text3);
  letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px;
}
.fld input, .fld textarea {
  width: 100%; padding: 12px 14px; background: var(--bg);
  border: 1px solid var(--border); border-radius: var(--r2);
  color: var(--text); font-family: var(--mono); font-size: 13px;
  outline: none; transition: all .25s ease; resize: none;
}
.fld input:focus, .fld textarea:focus {
  border-color: rgba(34,184,230,.4);
  background: rgba(34,184,230,.03);
  box-shadow: 0 0 0 3px rgba(34,184,230,.08);
}
.fld input::placeholder, .fld textarea::placeholder { color: var(--text3) }

.sep { height: 1px; background: var(--border); margin: 20px 0 }

.fee-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px }
.fee-l { font-size: 13px; color: var(--text3) }
.fee-v { font-size: 13px; color: var(--text2); font-family: var(--mono) }

/* ---- BUTTONS ---- */
.primary-btn {
  width: 100%; padding: 14px; background: var(--accent); border: none;
  border-radius: var(--r2); color: #fff; font-family: var(--sans);
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all .25s ease; letter-spacing: -.1px;
  box-shadow: 0 2px 20px rgba(34,184,230,.25);
}
.primary-btn:hover:not(:disabled) {
  background: #1a9ec2; box-shadow: 0 4px 28px rgba(34,184,230,.4);
  transform: translateY(-1px);
}
.primary-btn:active:not(:disabled) { transform: translateY(0) }
.primary-btn:disabled { opacity: .35; cursor: not-allowed; transform: none; box-shadow: none }

.ghost-btn {
  width: 100%; padding: 12px; background: transparent;
  border: 1px solid var(--border); border-radius: var(--r2);
  color: var(--text2); font-family: var(--sans); font-size: 13px;
  font-weight: 500; cursor: pointer; transition: all .25s ease; margin-top: 10px;
}
.ghost-btn:hover { border-color: var(--border2); color: var(--text) }
.danger-btn { color: rgba(248,113,113,.5); border-color: rgba(248,113,113,.12) }
.danger-btn:hover { color: rgba(248,113,113,.8); border-color: rgba(248,113,113,.25) }

/* ---- STATUS & ERRORS ---- */
.error-card {
  margin-top: 16px; padding: 18px; border-radius: 12px;
  background: var(--red-dim); border: 1px solid rgba(248,113,113,.15);
  animation: fade-up .3s ease;
}
.error-card.warn { background: var(--amber-dim); border-color: rgba(251,191,36,.15) }
.error-card-title {
  font-size: 13px; font-weight: 700; color: var(--red);
  margin-bottom: 6px; display: flex; align-items: center; gap: 8px;
}
.error-card.warn .error-card-title { color: var(--amber) }
.error-card-desc { font-size: 12px; color: var(--text2); line-height: 1.7 }
.error-card-action {
  margin-top: 10px; padding-top: 10px;
  border-top: 1px solid rgba(248,113,113,.1);
  font-size: 12px; color: rgba(248,113,113,.65); line-height: 1.6;
}
.error-card.warn .error-card-action { border-color: rgba(251,191,36,.12); color: rgba(251,191,36,.65) }
.error-dismiss {
  float: right; background: none; border: none; color: var(--text3);
  font-size: 14px; cursor: pointer; padding: 0; margin-top: -2px; line-height: 1;
  transition: color .2s;
}
.error-dismiss:hover { color: var(--text2) }

.status-box {
  margin-top: 14px; padding: 14px 16px; border-radius: var(--r2);
  background: var(--accent-dim); border: 1px solid rgba(34,184,230,.15);
  animation: fade-up .3s ease;
}
.status-box pre {
  font-family: var(--mono); font-size: 12px; color: var(--accent2);
  white-space: pre-wrap; margin: 0; line-height: 1.7;
}
.status-box.ok { background: var(--green-dim); border-color: var(--green-border) }
.status-box.ok pre { color: var(--green) }
.status-box.err { background: var(--red-dim); border-color: rgba(248,113,113,.15) }
.status-box.err pre { color: var(--red) }

/* ---- RECEIVE: PAY LINK BOX ---- */
.link-box {
  background: var(--bg); border: 1px solid rgba(34,184,230,.2);
  border-radius: 14px; padding: 18px; margin-bottom: 16px;
}
.link-box-label {
  font-size: 10px; font-weight: 600; color: var(--text3);
  letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 10px;
}
.link-url {
  font-family: var(--mono); font-size: 11px; color: var(--accent2);
  word-break: break-all; line-height: 1.8; cursor: pointer;
  transition: color .2s;
}
.link-url:hover { color: #7ee3ff }
.link-actions { display: flex; gap: 8px; margin-top: 12px }
.link-btn {
  flex: 1; padding: 9px; background: var(--accent-dim);
  border: 1px solid rgba(34,184,230,.2); border-radius: 8px;
  color: var(--accent2); font-family: var(--sans); font-size: 12px;
  font-weight: 600; cursor: pointer; transition: all .25s ease; text-align: center;
}
.link-btn:hover { background: var(--accent-glow) }
.link-copied { color: var(--green); border-color: var(--green-border); background: var(--green-dim) }

/* ---- RECEIVE: DEPOSITS ---- */
.deposit-item { padding: 18px 20px; border-bottom: 1px solid var(--border); animation: fade-up .35s ease both }
.deposit-item:last-child { border-bottom: none }
.deposit-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px }
.deposit-amt { font-size: 18px; font-weight: 700; color: var(--green) }
.deposit-token { font-size: 12px; color: var(--text3); font-weight: 600 }
.deposit-addr { font-size: 11px; color: var(--text3); margin-bottom: 12px; font-family: var(--mono) }

/* ---- NO KEYS STATE ---- */
.no-keys { text-align: center; padding: 16px 0 8px }
.no-keys-icon {
  width: 64px; height: 64px; margin: 0 auto 16px; border-radius: 18px;
  background: var(--accent-dim); display: flex; align-items: center;
  justify-content: center; font-size: 28px; border: 1px solid rgba(34,184,230,.12);
}
.no-keys-title { font-size: 16px; font-weight: 600; color: var(--text); margin-bottom: 6px }
.no-keys-sub { font-size: 13px; color: var(--text3); margin-bottom: 24px; line-height: 1.6 }

/* ---- WARNING ---- */
.warning-box {
  background: var(--amber-dim); border: 1px solid rgba(251,191,36,.12);
  border-radius: var(--r2); padding: 14px 16px;
}
.warning-box p { font-size: 12px; color: rgba(251,191,36,.75); line-height: 1.7; margin: 0 }

/* ---- MODAL ---- */
.modal-bg {
  position: fixed; inset: 0; background: rgba(0,0,0,.75);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  z-index: 1000; display: flex; align-items: center;
  justify-content: center; padding: 24px;
  animation: fade-in .2s ease;
}
.modal {
  background: var(--surface); border: 1px solid var(--border2);
  border-radius: 20px; padding: 32px; width: 100%; max-width: 420px;
  animation: modal-up .3s ease;
}
.modal-title { font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 6px }
.modal-sub { font-size: 13px; color: var(--text3); margin-bottom: 24px; line-height: 1.6 }
.modal-close {
  float: right; background: none; border: none; color: var(--text3);
  font-size: 18px; cursor: pointer; margin-top: -4px;
  transition: color .2s;
}
.modal-close:hover { color: var(--text) }
.modal-actions { display: flex; gap: 8px; margin-top: 20px }
.modal-actions .primary-btn { margin: 0 }
.modal-actions .ghost-btn { margin: 0 }
.modal-err { font-size: 12px; color: var(--red); margin-top: 10px }

/* ---- FOOTER ---- */
.footer {
  margin-top: 60px; padding-top: 24px; border-top: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center;
}
.footer-l {
  font-size: 13px; font-weight: 700; color: var(--accent2);
  letter-spacing: 2px;
}
.footer-r { display: flex; gap: 24px }
.footer-link {
  font-size: 12px; color: var(--text3); text-decoration: none;
  transition: color .2s; font-weight: 500;
}
.footer-link:hover { color: var(--text2) }

/* ---- ANIMATIONS ---- */
@keyframes fade-up {
  from { opacity: 0; transform: translateY(10px) }
  to { opacity: 1; transform: translateY(0) }
}
@keyframes fade-in {
  from { opacity: 0 } to { opacity: 1 }
}
@keyframes modal-up {
  from { opacity: 0; transform: translateY(16px) scale(.97) }
  to { opacity: 1; transform: translateY(0) scale(1) }
}
@keyframes shimmer {
  0% { background-position: -200% 0 }
  100% { background-position: 200% 0 }
}
@keyframes spin {
  to { transform: rotate(360deg) }
}
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34,184,230,.3) }
  50% { box-shadow: 0 0 0 6px rgba(34,184,230,0) }
}

/* ---- FIXED DENOMINATIONS ---- */
.denom-toggle {
  display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
  padding: 10px 14px; background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--r2); cursor: pointer; transition: border-color .2s;
}
.denom-toggle:hover { border-color: var(--border2) }
.denom-switch {
  width: 36px; height: 20px; border-radius: 10px;
  background: var(--surface2); border: 1px solid var(--border2);
  position: relative; transition: all .25s; flex-shrink: 0;
}
.denom-switch.on { background: var(--accent-dim); border-color: var(--accent) }
.denom-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--text3); transition: all .25s;
}
.denom-switch.on::after { left: 18px; background: var(--accent) }
.denom-label { font-size: 12px; color: var(--text2); font-weight: 500 }
.denom-hint { font-size: 10px; color: var(--text3); margin-left: auto }
.denom-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 16px;
  animation: fade-up .25s ease;
}
.denom-btn {
  padding: 10px 0; background: var(--bg); border: 1px solid var(--border);
  border-radius: 8px; color: var(--text2); font-family: var(--mono);
  font-size: 13px; font-weight: 500; cursor: pointer; transition: all .2s;
  text-align: center;
}
.denom-btn:hover { border-color: var(--border2); color: var(--text) }
.denom-btn.on {
  background: var(--accent-dim); border-color: var(--accent);
  color: var(--accent2); box-shadow: 0 0 10px rgba(34,184,230,.08);
}

/* ---- PIPELINE TIMELINE ---- */
.timeline { margin-top: 16px; animation: fade-up .3s ease }
.timeline-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px;
}
.timeline-title { font-size: 13px; font-weight: 600; color: var(--text) }
.timeline-eta { font-size: 11px; color: var(--text3); font-family: var(--mono) }
.timeline-bar {
  height: 3px; background: var(--bg); border-radius: 2px;
  overflow: hidden; margin-bottom: 18px;
}
.timeline-fill {
  height: 100%; border-radius: 2px;
  background: linear-gradient(90deg, var(--accent), var(--accent2));
  transition: width 1.5s ease;
}
.timeline-steps { display: flex; flex-direction: column; gap: 0 }
.tl-step {
  display: flex; align-items: flex-start; gap: 12px; padding: 8px 0;
  position: relative;
}
.tl-step:not(:last-child)::before {
  content: ''; position: absolute; left: 11px; top: 28px;
  width: 1px; height: calc(100% - 16px); background: var(--border);
}
.tl-step.done:not(:last-child)::before { background: rgba(34,184,230,.25) }
.tl-dot {
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; transition: all .3s;
}
.tl-dot.done { background: rgba(52,211,153,.12); color: var(--green) }
.tl-dot.active {
  background: var(--accent-dim); border: 1.5px solid var(--accent);
  animation: pulse-glow 2s ease-in-out infinite;
}
.tl-dot.active .tl-spinner {
  width: 10px; height: 10px; border: 1.5px solid var(--border);
  border-top-color: var(--accent2); border-radius: 50%;
  animation: spin .8s linear infinite;
}
.tl-dot.pending { background: var(--surface2); }
.tl-dot.pending::after {
  content: ''; width: 5px; height: 5px; border-radius: 50%;
  background: var(--text3);
}
.tl-info { flex: 1; min-width: 0 }
.tl-name { font-size: 12px; font-weight: 500; color: var(--text2) }
.tl-step.done .tl-name { color: var(--text) }
.tl-step.active .tl-name { color: var(--accent2) }
.tl-detail { font-size: 10px; color: var(--text3); font-family: var(--mono); margin-top: 2px }

/* ---- TIER BADGE ---- */
.tier-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px }
.tier-badge {
  font-size: 10px; font-weight: 600; padding: 3px 9px; border-radius: 10px;
  letter-spacing: .04em;
}
.tier-standard { background: var(--accent-dim); color: var(--accent2); border: 1px solid rgba(34,184,230,.15) }
.tier-volume { background: rgba(52,211,153,.08); color: var(--green); border: 1px solid rgba(52,211,153,.15) }
.tier-premium { background: rgba(251,191,36,.06); color: var(--amber); border: 1px solid rgba(251,191,36,.15) }

/* ---- NOTIF BANNER ---- */
.notif-banner {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; margin-bottom: 14px;
  background: var(--accent-dim); border: 1px solid rgba(34,184,230,.12);
  border-radius: var(--r2); cursor: pointer; transition: all .2s;
  animation: fade-up .3s ease;
}
.notif-banner:hover { border-color: var(--accent) }
.notif-text { font-size: 12px; color: var(--text2); flex: 1 }
.notif-action { font-size: 11px; color: var(--accent2); font-weight: 600; white-space: nowrap }

/* ---- RESPONSIVE ---- */
@media (max-width: 760px) {
  .grid { grid-template-columns: 1fr }
  .form-card { position: static }
  .hdr { padding: 16px 0; margin-bottom: 24px }
  .tabs { width: 100% }
  .tab { flex: 1; text-align: center; padding: 10px 0 }
  .wrap { padding: 0 16px 60px }
}
`;

/* ============================================================
   COMPONENT
   ============================================================ */
export default function App() {
  const [account, setAccount]         = useState(null);
  const [tab, setTab]                 = useState("send");
  const [amount, setAmount]           = useState("");
  const [payLink, setPayLink]         = useState("");
  const [token, setToken]             = useState("ETH");
  const [status, setStatus]           = useState("");
  const [statusType, setStatusType]   = useState("");
  const [errorInfo, setErrorInfo]     = useState(null);
  const [loading, setLoading]         = useState(false);
  const [history, setHistory]         = useState([]);
  const [pendingId, setPendingId]     = useState(null);
  const [accordOpen, setAccordOpen]   = useState(false);
  const [myKeys, setMyKeys]           = useState(null);
  const [scanning, setScanning]       = useState(false);
  const [deposits, setDeposits]       = useState([]);
  const [withdrawing, setWithdrawing] = useState(null);
  const [linkCopied, setLinkCopied]   = useState(false);
  const [modal, setModal]             = useState(null);
  const [modalPwd, setModalPwd]       = useState("");
  const [modalPwd2, setModalPwd2]     = useState("");
  const [modalErr, setModalErr]       = useState("");
  const [modalFile, setModalFile]     = useState(null);
  const [useFixedDenom, setUseFixedDenom] = useState(false);
  const [useTimelocked, setUseTimelocked] = useState(false);
  const [pipelineData, setPipelineData]   = useState(null); // { hopsFeitos, hopsTotal, splits, concluido }
  const [notifPerm, setNotifPerm]         = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");

  // ZK states
  const [zkMode, setZkMode]               = useState("deposit"); // "deposit" or "withdraw"
  const [zkToken, setZkToken]             = useState("ETH");
  const [zkDenom, setZkDenom]             = useState("");
  const [zkStatus, setZkStatus]           = useState("");
  const [zkLoading, setZkLoading]         = useState(false);
  const [zkNotes, setZkNotes]             = useState([]); // saved notes [{secret, nullifier, commitment, leafIndex, token, denomination, timestamp}]
  const [zkWithdrawNote, setZkWithdrawNote] = useState(null);
  const [zkRecipient, setZkRecipient]     = useState("");

  // ZK Contract
  const ZK_CONTRACT = "0xB2c88ff42e75879feE4A680b3577BA57bed8Af8e";
  const ZK_ABI = [
    "function depositETH(uint256 commitment) external payable",
    "function depositToken(address token, uint256 amount, uint256 commitment) external",
    "function getLastRoot() external view returns (uint256)",
    "function getTreeSize() external view returns (uint256)",
    "function isSpent(uint256 nullifierHash) external view returns (bool)",
    "event Deposit(uint256 indexed commitment, uint256 leafIndex, uint256 timestamp, address token, uint256 denomination)",
  ];
  const ZK_DENOMS = {
    ETH:  ["0.01", "0.05", "0.1", "0.5", "1"],
    USDC: ["10", "50", "100", "500", "1000"],
    USDT: ["10", "50", "100", "500", "1000"],
  };

  // FIELD_SIZE for ZK
  const FIELD_SIZE = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

  // Load ZK notes from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sf_zk_notes");
    if (saved) { try { setZkNotes(JSON.parse(saved)); } catch {} }
  }, []);
  useEffect(() => {
    if (zkNotes.length > 0) localStorage.setItem("sf_zk_notes", JSON.stringify(zkNotes));
  }, [zkNotes]);

  // Denominacoes fixas por token (melhora anonymity set)
  const DENOMS = {
    ETH:  ["0.005", "0.01", "0.02", "0.05", "0.1", "0.5"],
    USDC: ["5", "10", "25", "50", "100", "500"],
    USDT: ["5", "10", "25", "50", "100", "500"],
  };

  const requestNotifPermission = () => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().then(p => setNotifPerm(p));
    }
  };

  const sendNotification = (title, body) => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification(title, { body, icon: "/logo.png" }); } catch {}
    }
  };

  // Detecta link de pagamento na URL (/p/st:...)
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/p\/(.+)$/);
    if (match) {
      const meta = decodeURIComponent(match[1]);
      if (meta.startsWith("st:")) { setPayLink(meta); setTab("send"); }
    }
  }, []);

  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = STYLE;
    document.head.appendChild(s);
    return () => document.head.removeChild(s);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("sf_keys");
    if (saved) { try { setMyKeys(JSON.parse(saved)); } catch {} }
  }, []);

  useEffect(() => {
    if (myKeys) localStorage.setItem("sf_keys", JSON.stringify(myKeys));
  }, [myKeys]);

  // Poll status do pipeline com timeout de 20 minutos
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
    let pollCount = 0;
    const MAX_POLLS = 80;
    const iv = setInterval(async () => {
      pollCount++;
      try {
        const r = await fetch(`${BACKEND_URL}/status/${pendingId}`);
        const d = await r.json();
        if (d.concluido) {
          setStatus("Enviado com sucesso. O destinatario pode sacar a qualquer momento.");
          setStatusType("ok");
          setErrorInfo(null);
          setPipelineData({ ...d, concluido: true });
          sendNotification("SilentFlow", "Transacao privada concluida com sucesso!");
          clearInterval(iv); setPendingId(null);
          setHistory(h => h.map(t => t.id === pendingId ? { ...t, done: true } : t));
        } else if (pollCount >= MAX_POLLS) {
          clearInterval(iv); setPendingId(null);
          setStatus(""); setPipelineData(null);
          setErrorInfo({ title: "Pipeline demorou mais que o esperado", desc: "Os fundos foram enviados com sucesso para o pipeline, mas o processo de hops esta demorando mais que o normal.", action: "Nao se preocupe — seus fundos estao seguros. Aguarde mais alguns minutos e escaneie a blockchain na aba Receber para verificar se chegaram.", type: "warn" });
        } else {
          setPipelineData(d);
          setStatus(`Processando... ${d.hopsFeitos}/${d.hopsTotal} etapas - ~${d.minutosRestantes} min restantes`);
        }
      } catch (fetchErr) {
        if (pollCount >= MAX_POLLS) {
          clearInterval(iv); setPendingId(null);
          setErrorInfo({ title: "Conexao perdida", desc: "Nao foi possivel verificar o status do pipeline.", action: "Verifique sua internet. Seus fundos estao seguros — escaneie a blockchain na aba Receber.", type: "warn" });
        }
      }
    }, 15000);
    return () => clearInterval(iv);
  }, [pendingId]);

  const connect = async () => {
    if (!window.ethereum) return alert("MetaMask nao encontrada.");
    const p = new ethers.BrowserProvider(window.ethereum);
    const [acc] = await p.send("eth_requestAccounts", []);
    setAccount(acc);
  };

  const send = async () => {
    if (!account) return alert("Conecte sua carteira.");
    if (!amount || !payLink) return alert("Preencha o valor e o link de pagamento.");
    setLoading(true); setStatus("Iniciando envio privado..."); setStatusType(""); setErrorInfo(null); setPipelineData(null);
    try {
      const metaAddress = parsePayLink(payLink);
      if (!metaAddress) throw new Error("Link de pagamento invalido. Cole o link ou o endereco st:...");
      const { stealthAddress, ephemeralPubKey, viewTag } = deriveStealthAddress(metaAddress);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();

      setStatus("Gerando endereco de entrada privado...");
      const entradaRes = await fetch(`${BACKEND_URL}/entrada?token=${token}&stealthAddress=${stealthAddress}&ephemeralPubKey=${ephemeralPubKey}&viewTag=${viewTag}&timelocked=${useTimelocked}`);
      const entradaData = await entradaRes.json();
      if (entradaData.erro) throw new Error(entradaData.erro);
      const { entradaAddress } = entradaData;

      let txHash, valorWei;
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
      setHistory(h => [{ id: pipelineId, hash: txHash, amount, token, recipient: stealthAddress.slice(0,6) + "..." + stealthAddress.slice(-4), time: new Date().toLocaleTimeString("pt-BR"), done: false }, ...h]);
      setStatus("Envio iniciado com sucesso.\nSeu destinatario recebera os fundos em ~8 min de forma completamente privada.");
      setAmount(""); setPayLink("");
    } catch (e) {
      const info = classifyError(e);
      setErrorInfo(info); setStatus(""); setStatusType("");
    }
    setLoading(false);
  };

  const generateKeys = () => { setMyKeys(generateStealthKeys()); setDeposits([]); };
  const copyLink = () => {
    if (!myKeys) return;
    navigator.clipboard.writeText(buildPayLink(myKeys.metaAddress));
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
  };
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "silentflow-backup.json"; a.click();
      URL.revokeObjectURL(url);
      closeModal();
    } catch (e) { setModalErr("Erro ao criptografar: " + e.message); }
  };

  const doImport = async () => {
    if (!modalFile) return setModalErr("Selecione o arquivo.");
    if (!modalPwd) return setModalErr("Digite a senha.");
    try {
      const text = await modalFile.text();
      const payload = JSON.parse(text);
      const keys = await decryptKeys(payload, modalPwd);
      if (!keys.spendingPrivKey || !keys.viewingPrivKey || !keys.metaAddress) throw new Error("Arquivo invalido");
      setMyKeys(keys); setDeposits([]); closeModal();
    } catch (e) { setModalErr("Senha incorreta ou arquivo invalido."); }
  };

  const scan = useCallback(async () => {
    if (!myKeys || !account) return;
    setScanning(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
      const filter = contract.filters.StealthDeposit();
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 50000);
      const CHUNK = 2000;
      const events = [];
      for (let start = fromBlock; start < currentBlock; start += CHUNK) {
        const end = Math.min(start + CHUNK - 1, currentBlock);
        const chunk = await contract.queryFilter(filter, start, end);
        events.push(...chunk);
      }
      const found = [];
      for (const ev of events) {
        const ephemeralPubKey = ev.args[0];
        const stealthAddressOnChain = ev.args[1];
        const tokenAddr = ev.args[2];
        const viewTag = Number(ev.args[4]);
        const timelocked = ev.args[5] || false;
        const unlockAt = ev.args[6] ? Number(ev.args[6]) : 0;
        const result = tryDecryptDeposit(ephemeralPubKey, stealthAddressOnChain, viewTag, myKeys.spendingPrivKey, myKeys.viewingPrivKey);
        if (result) {
          const tokenAddrNorm = (!tokenAddr || tokenAddr === ethers.ZeroAddress) ? ethers.ZeroAddress : tokenAddr;
          const bal = await contract.balanceOf(stealthAddressOnChain, tokenAddrNorm);
          if (bal > 0n) {
            const tokenSymbol = tokenAddr === ethers.ZeroAddress ? "ETH"
              : Object.keys(TOKENS).find(k => TOKENS[k].address?.toLowerCase() === tokenAddr.toLowerCase()) || tokenAddr.slice(0,6);
            const decimals = tokenAddr === ethers.ZeroAddress ? 18 : (TOKENS[tokenSymbol]?.decimals || 18);
            // Verifica se esta unlocked
            let isLocked = false;
            if (timelocked && unlockAt > 0) {
              try {
                isLocked = !(await contract.isUnlocked(stealthAddressOnChain, tokenAddrNorm));
              } catch { isLocked = false; }
            }
            found.push({
              stealthAddress: stealthAddressOnChain,
              stealthPrivKey: result.stealthPrivKey,
              amount: ethers.formatUnits(bal, decimals),
              token: tokenSymbol,
              txHash: ev.transactionHash,
              timelocked,
              unlockAt,
              isLocked,
            });
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
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      const tokenAddr = TOKENS[deposit.token]?.address || ethers.ZeroAddress;
      const nonce = await contract.withdrawNonces(deposit.stealthAddress);
      const chainId = (await provider.getNetwork()).chainId;
      const dataHash = ethers.solidityPackedKeccak256(
        ["address","address","address","uint256","uint256"],
        [deposit.stealthAddress, tokenAddr, account, nonce, chainId]
      );
      const stealthSigner = new ethers.Wallet(deposit.stealthPrivKey);
      const sig = await stealthSigner.signMessage(ethers.getBytes(dataHash));
      const tx = await contract.withdrawFor(deposit.stealthAddress, tokenAddr, account, sig);
      await tx.wait();
      setDeposits(d => d.filter(x => x.stealthAddress !== deposit.stealthAddress));
      alert("Saque realizado com sucesso!");
    } catch (e) { alert("Erro ao sacar: " + (e.reason || e.message)); }
    setWithdrawing(null);
  };

  // ============================================================
  // ZK FUNCTIONS
  // ============================================================

  // Gera random field element
  const randomFieldElement = () => {
    const bytes = new Uint8Array(31); // 31 bytes para ficar dentro do campo
    crypto.getRandomValues(bytes);
    let hex = "0x";
    bytes.forEach(b => hex += b.toString(16).padStart(2, "0"));
    const val = BigInt(hex) % FIELD_SIZE;
    return val.toString();
  };

  // Poseidon hash — carregado via circomlibjs (mesmo que o circuit usa)
  const [poseidonFn, setPoseidonFn] = useState(null);

  useEffect(() => {
    // Carrega circomlibjs para ter Poseidon identico ao circuit
    const loadPoseidon = async () => {
      try {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/circomlibjs@0.1.7/build/circomlibjs.umd.min.js";
        script.onload = async () => {
          if (window.circomlibjs) {
            const poseidon = await window.circomlibjs.buildPoseidon();
            setPoseidonFn(() => poseidon);
            console.log("Poseidon loaded");
          }
        };
        document.head.appendChild(script);
      } catch (e) { console.error("Failed to load Poseidon:", e); }
    };
    loadPoseidon();
  }, []);

  // Hash com Poseidon (identico ao circuit e ao contrato)
  const zkHash = (left, right) => {
    if (!poseidonFn) {
      // Fallback — nao deve ser usado em producao
      console.warn("Poseidon not loaded, using fallback");
      const packed = ethers.solidityPackedKeccak256(["uint256", "uint256"], [left, right]);
      return (BigInt(packed) % FIELD_SIZE).toString();
    }
    const hash = poseidonFn([BigInt(left), BigInt(right)]);
    return poseidonFn.F.toString(hash);
  };

  // Gera commitment = hash(secret, nullifier)
  const generateCommitment = () => {
    const secret = randomFieldElement();
    const nullifier = randomFieldElement();
    const commitment = zkHash(secret, nullifier);
    const nullifierHash = zkHash(nullifier, nullifier);
    return { secret, nullifier, commitment, nullifierHash };
  };

  // ZK Deposit
  const zkDeposit = async () => {
    if (!account) return alert("Conecte sua carteira.");
    if (!zkDenom) return alert("Selecione uma denominacao.");
    if (!poseidonFn) return alert("Aguarde o Poseidon carregar (recarregue a pagina se demorar).");
    setZkLoading(true); setZkStatus("Gerando commitment...");
    try {
      const { secret, nullifier, commitment, nullifierHash } = generateCommitment();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(ZK_CONTRACT, ZK_ABI, signer);

      if (zkToken === "ETH") {
        const valorWei = ethers.parseEther(zkDenom);
        setZkStatus("Aguardando confirmacao na carteira...");
        const tx = await contract.depositETH(commitment, { value: valorWei });
        setZkStatus("Confirmando deposito ZK...");
        await tx.wait();

        // Busca o leafIndex do evento
        const receipt = await provider.getTransactionReceipt(tx.hash);
        let leafIndex = 0;
        for (const log of receipt.logs) {
          try {
            const parsed = contract.interface.parseLog(log);
            if (parsed && parsed.name === "Deposit") {
              leafIndex = Number(parsed.args[1]);
            }
          } catch {}
        }

        // Salva a note (secret + nullifier + metadata)
        const note = {
          secret, nullifier, commitment, nullifierHash,
          leafIndex, token: "ETH", denomination: zkDenom,
          txHash: tx.hash, timestamp: Date.now(),
        };
        setZkNotes(prev => [...prev, note]);
        setZkStatus(`Deposito ZK concluido! Nota #${leafIndex} salva. GUARDE ESTA NOTA — sem ela voce nao consegue sacar.`);
      } else {
        const t = TOKENS[zkToken];
        const valorUnits = ethers.parseUnits(zkDenom, t.decimals);
        const tc = new ethers.Contract(t.address, ERC20_ABI, signer);
        setZkStatus("Aprovando token...");
        const allow = await tc.allowance(account, ZK_CONTRACT);
        if (allow < valorUnits) {
          const appTx = await tc.approve(ZK_CONTRACT, valorUnits);
          await appTx.wait();
        }
        setZkStatus("Aguardando confirmacao na carteira...");
        const tx = await contract.depositToken(t.address, valorUnits, commitment);
        setZkStatus("Confirmando deposito ZK...");
        await tx.wait();

        const receipt = await provider.getTransactionReceipt(tx.hash);
        let leafIndex = 0;
        for (const log of receipt.logs) {
          try {
            const parsed = contract.interface.parseLog(log);
            if (parsed && parsed.name === "Deposit") {
              leafIndex = Number(parsed.args[1]);
            }
          } catch {}
        }

        const note = {
          secret, nullifier, commitment, nullifierHash,
          leafIndex, token: zkToken, denomination: zkDenom,
          txHash: tx.hash, timestamp: Date.now(),
        };
        setZkNotes(prev => [...prev, note]);
        setZkStatus(`Deposito ZK concluido! Nota #${leafIndex} salva.`);
      }
      setZkDenom("");
    } catch (e) {
      setZkStatus(`Erro: ${e.reason || e.message}`);
    }
    setZkLoading(false);
  };

  // ZK Withdraw — gera proof e saca
  const zkWithdraw = async (note) => {
    if (!account) return alert("Conecte sua carteira.");
    const recipient = zkRecipient || account;
    setZkLoading(true); setZkStatus("Sincronizando commitment...");
    try {
      // 0. Garante que o backend conhece o commitment
      await fetch(`${BACKEND_URL}/zk/add-commitment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitment: note.commitment }),
      });

      setZkStatus("Buscando Merkle path...");

      // 1. Busca Merkle path do backend
      const pathRes = await fetch(`${BACKEND_URL}/zk/merkle-path/${note.leafIndex}`);
      const pathData = await pathRes.json();
      if (pathData.erro) throw new Error(pathData.erro);

      setZkStatus("Gerando ZK proof (pode demorar 30-60s)...");

      // 2. Prepara inputs para o circuit
      const tokenAddr = TOKENS[note.token]?.address || ethers.ZeroAddress;
      const denomWei = note.token === "ETH"
        ? ethers.parseEther(note.denomination).toString()
        : ethers.parseUnits(note.denomination, TOKENS[note.token].decimals).toString();

      const input = {
        root: pathData.root,
        nullifierHash: note.nullifierHash,
        recipient: BigInt(recipient).toString(),
        denomination: denomWei,
        secret: note.secret,
        nullifier: note.nullifier,
        pathElements: pathData.pathElements,
        pathIndices: pathData.pathIndices,
      };

      // 3. Gera ZK proof com snarkjs (carregado via CDN)
      if (!window.snarkjs) {
        setZkStatus("Carregando snarkjs...");
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/snarkjs@0.7.4/build/snarkjs.min.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      setZkStatus("Gerando prova zero-knowledge...");
      const { proof } = await window.snarkjs.groth16.fullProve(
        input,
        "/silentflow.wasm",
        "/silentflow_final.zkey"
      );

      // 4. Formata proof para o contrato
      const a = [proof.pi_a[0], proof.pi_a[1]];
      const b = [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]];
      const c = [proof.pi_c[0], proof.pi_c[1]];

      setZkStatus("Enviando saque anonimo...");

      // 5. Chama withdraw no contrato
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(ZK_CONTRACT, [
        "function withdraw(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256 root, uint256 nullifierHash, address payable recipient, address token, uint256 denomination, uint256 relayerFee) external",
      ], signer);

      const tx = await contract.withdraw(
        a, b, c,
        pathData.root,
        note.nullifierHash,
        recipient,
        tokenAddr,
        denomWei,
        0 // sem relayer fee por agora
      );
      setZkStatus("Confirmando saque...");
      await tx.wait();

      // Remove note da lista
      setZkNotes(prev => prev.filter(n => n.commitment !== note.commitment));
      setZkStatus("Saque ZK anonimo concluido! Ninguem sabe qual deposito foi sacado.");
      sendNotification("SilentFlow ZK", "Saque anonimo concluido com sucesso!");
    } catch (e) {
      setZkStatus(`Erro: ${e.reason || e.message}`);
    }
    setZkLoading(false);
  };

  // Export ZK notes (backup)
  const exportZkNotes = () => {
    if (zkNotes.length === 0) return;
    const blob = new Blob([JSON.stringify(zkNotes, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = "silentflow-zk-notes.json"; a.click();
    URL.revokeObjectURL(url);
  };

  // Import ZK notes
  const importZkNotes = (file) => {
    if (!file) return;
    file.text().then(text => {
      try {
        const notes = JSON.parse(text);
        if (Array.isArray(notes)) { setZkNotes(notes); setZkStatus("Notas ZK importadas!"); }
      } catch { setZkStatus("Arquivo invalido."); }
    });
  };

  // Taxa por tier
  const getTierInfo = (amt, tok) => {
    const v = parseFloat(amt);
    if (isNaN(v) || v <= 0) return { pct: 0.002, label: "Standard", cls: "tier-standard" };
    if (tok === "ETH") {
      if (v >= 1.5) return { pct: 0.001, label: "Premium", cls: "tier-premium" };
      if (v >= 0.15) return { pct: 0.0015, label: "Volume", cls: "tier-volume" };
    } else {
      if (v >= 5000) return { pct: 0.001, label: "Premium", cls: "tier-premium" };
      if (v >= 500) return { pct: 0.0015, label: "Volume", cls: "tier-volume" };
    }
    return { pct: 0.002, label: "Standard", cls: "tier-standard" };
  };
  const tierInfo = getTierInfo(amount, token);
  const fee = amount && !isNaN(parseFloat(amount)) ? `${(parseFloat(amount) * tierInfo.pct).toFixed(6)} ${token}` : "\u2014";
  const feePercent = amount && !isNaN(parseFloat(amount)) ? `${(tierInfo.pct * 100).toFixed(2)}%` : "0.20%";
  const payLink_isValid = payLink && (payLink.startsWith("st:") || payLink.includes("/p/st:"));

  return (
    <>
      <div className="bg-glow" />

      {/* ---- MODAL ---- */}
      {modal && (
        <div className="modal-bg" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>&times;</button>
            {modal === "export" ? (
              <>
                <div className="modal-title">Backup criptografado</div>
                <div className="modal-sub">Suas chaves serao criptografadas com sua senha antes de salvar. Use uma senha forte que voce nao vai esquecer.</div>
                <div className="fld"><label>Senha</label><input type="password" placeholder="Minimo 6 caracteres" value={modalPwd} onChange={e => setModalPwd(e.target.value)} /></div>
                <div className="fld"><label>Confirmar senha</label><input type="password" placeholder="Repita a senha" value={modalPwd2} onChange={e => setModalPwd2(e.target.value)} /></div>
                {modalErr && <div className="modal-err">{modalErr}</div>}
                <div className="modal-actions"><button className="primary-btn" onClick={doExport}>Baixar backup</button></div>
              </>
            ) : (
              <>
                <div className="modal-title">Restaurar backup</div>
                <div className="modal-sub">Selecione o arquivo de backup e digite a senha usada na criacao.</div>
                <div className="fld"><label>Arquivo de backup</label><input type="file" accept=".json" style={{fontFamily:"inherit",fontSize:"12px",color:"var(--text2)",padding:"10px"}} onChange={e => setModalFile(e.target.files[0])} /></div>
                <div className="fld"><label>Senha</label><input type="password" placeholder="Senha do backup" value={modalPwd} onChange={e => setModalPwd(e.target.value)} /></div>
                {modalErr && <div className="modal-err">{modalErr}</div>}
                <div className="modal-actions"><button className="primary-btn" onClick={doImport}>Restaurar</button></div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="wrap">
        {/* ---- HEADER ---- */}
        <header className="hdr">
          <div className="logo">
            <img src="/logo.png" alt="SilentFlow" />
            <span className="logo-name">SilentFlow</span>
          </div>
          <div className="hdr-right">
            <div className="net-badge"><span className="net-dot" /> SEPOLIA</div>
            <button className={`conn-btn${account ? " on" : ""}`} onClick={connect}>
              {account ? `${account.slice(0,6)}...${account.slice(-4)}` : "Conectar Carteira"}
            </button>
          </div>
        </header>

        {/* ---- TABS ---- */}
        <div className="tabs">
          <button className={`tab${tab==="send"?" on":""}`} onClick={() => setTab("send")}>Enviar</button>
          <button className={`tab${tab==="receive"?" on":""}`} onClick={() => setTab("receive")}>Receber</button>
          <button className={`tab${tab==="zk"?" on":""}`} onClick={() => setTab("zk")}>ZK Privacy</button>
        </div>

        {/* ============ TAB: SEND ============ */}
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
                        <div className="hist-to">{tx.recipient}</div>
                        <div className="hist-foot">
                          <span className={`pill ${tx.done?"done":"proc"}`}>{tx.done?"Entregue":"Processando"}</span>
                          <a className="hist-link" href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noreferrer">Etherscan</a>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
              <div className="info-card">
                <div className="info-toggle" onClick={() => setAccordOpen(o => !o)}>
                  <span className="info-label">Como funciona a privacidade</span>
                  <span className={`info-arrow${accordOpen?" open":""}`}>&#9660;</span>
                </div>
                <div className={`info-body${accordOpen?" open":""}`}>
                  {[
                    ["Entrada descartavel", "endereco novo por tx"],
                    ["Stealth address",     "destinatario invisivel"],
                    ["Split automatico",    "2-3 partes aleatorias"],
                    ["Multi-hop real",      "2 wallets efemeras/parte"],
                    ["Delays inteligentes", "5 perfis, 20s-200s por hop"],
                    ["Dummy noise",         "ruido antes/durante/depois"],
                    ["Denomin. fixas",      "anonymity set maior"],
                    ["Taxa",                "0.10% - 0.20% por tier"],
                  ].map(([k,v]) => (
                    <div className="info-row" key={k}>
                      <span className="info-k">{k}</span>
                      <span className="info-v">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ---- SEND FORM ---- */}
            <div className="form-card">
              <div className="form-title">Enviar</div>
              <div className="form-sub">Cole o link de pagamento do destinatario</div>

              {/* Notif permission */}
              {notifPerm === "default" && (
                <div className="notif-banner" onClick={requestNotifPermission}>
                  <span className="notif-text">Receba alertas quando sua transacao for concluida</span>
                  <span className="notif-action">Ativar</span>
                </div>
              )}

              <div className="toks">
                {Object.keys(TOKENS).map(t => (
                  <button key={t} className={`tok${token===t?" on":""}`} onClick={() => { setToken(t); setAmount(""); }}>{t}</button>
                ))}
              </div>

              {/* Fixed denomination toggle */}
              <div className="denom-toggle" onClick={() => setUseFixedDenom(d => !d)}>
                <div className={`denom-switch${useFixedDenom?" on":""}`} />
                <span className="denom-label">Valor fixo (mais privacidade)</span>
                <span className="denom-hint">anonymity set</span>
              </div>

              {/* Time-lock toggle */}
              <div className="denom-toggle" onClick={() => setUseTimelocked(t => !t)}>
                <div className={`denom-switch${useTimelocked?" on":""}`} />
                <span className="denom-label">Time-lock (privacidade maxima)</span>
                <span className="denom-hint">saque na proxima janela</span>
              </div>

              {useFixedDenom ? (
                <div className="denom-grid">
                  {DENOMS[token].map(d => (
                    <button key={d} className={`denom-btn${amount===d?" on":""}`} onClick={() => setAmount(d)}>
                      {d} {token}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="fld">
                  <label>Valor</label>
                  <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
                </div>
              )}

              <div className="fld">
                <label>Link de pagamento</label>
                <input type="text" placeholder="silentflow.vercel.app/p/st:... ou st:..." value={payLink} onChange={e => setPayLink(e.target.value)} style={payLink_isValid ? {borderColor:"rgba(52,211,153,.35)"} : {}} />
              </div>
              <div className="sep" />

              {/* Fee with tier */}
              <div className="tier-row">
                <span className="fee-l">Taxa de privacidade</span>
                <span className={`tier-badge ${tierInfo.cls}`}>{tierInfo.label} {feePercent}</span>
              </div>
              <div className="fee-row">
                <span className="fee-l">Custo estimado</span>
                <span className="fee-v">{fee}</span>
              </div>

              <button className="primary-btn" onClick={send} disabled={loading || !account}>
                {loading ? "Processando..." : "Enviar com privacidade"}
              </button>

              {/* Pipeline Timeline Visual */}
              {pipelineData && !pipelineData.concluido && !errorInfo && (
                <div className="timeline">
                  <div className="timeline-header">
                    <span className="timeline-title">Pipeline ativo</span>
                    <span className="timeline-eta">~{pipelineData.minutosRestantes || 0} min</span>
                  </div>
                  <div className="timeline-bar">
                    <div className="timeline-fill" style={{width: `${pipelineData.hopsTotal > 0 ? Math.round((pipelineData.hopsFeitos / pipelineData.hopsTotal) * 100) : 0}%`}} />
                  </div>
                  <div className="timeline-steps">
                    {/* Step 1: Entrada detectada */}
                    <div className="tl-step done">
                      <div className="tl-dot done">&#10003;</div>
                      <div className="tl-info">
                        <div className="tl-name">Entrada detectada</div>
                        <div className="tl-detail">endereco descartavel verificado</div>
                      </div>
                    </div>
                    {/* Step 2: Split */}
                    <div className={`tl-step${pipelineData.hopsFeitos > 0 ? " done" : " done"}`}>
                      <div className="tl-dot done">&#10003;</div>
                      <div className="tl-info">
                        <div className="tl-name">Split em {pipelineData.splits || 2} partes</div>
                        <div className="tl-detail">valores aleatorios</div>
                      </div>
                    </div>
                    {/* Step 3: Hops */}
                    <div className={`tl-step${pipelineData.hopsFeitos >= pipelineData.hopsTotal ? " done" : " active"}`}>
                      <div className={`tl-dot${pipelineData.hopsFeitos >= pipelineData.hopsTotal ? " done" : " active"}`}>
                        {pipelineData.hopsFeitos >= pipelineData.hopsTotal ? "\u2713" : <span className="tl-spinner" />}
                      </div>
                      <div className="tl-info">
                        <div className="tl-name">Hops em andamento ({pipelineData.hopsFeitos}/{pipelineData.hopsTotal})</div>
                        <div className="tl-detail">wallets efemeras + delays aleatorios</div>
                      </div>
                    </div>
                    {/* Step 4: Deposito */}
                    <div className={`tl-step${pipelineData.hopsFeitos >= pipelineData.hopsTotal ? " active" : ""}`}>
                      <div className={`tl-dot${pipelineData.hopsFeitos >= pipelineData.hopsTotal ? " active" : " pending"}`}>
                        {pipelineData.hopsFeitos >= pipelineData.hopsTotal ? <span className="tl-spinner" /> : null}
                      </div>
                      <div className="tl-info">
                        <div className="tl-name">Deposito no contrato</div>
                        <div className="tl-detail">stealth address do destinatario</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Pipeline completed */}
              {pipelineData && pipelineData.concluido && !errorInfo && (
                <div className="timeline" style={{marginTop:"16px"}}>
                  <div className="timeline-bar"><div className="timeline-fill" style={{width:"100%"}} /></div>
                  <div className="tl-step done" style={{padding:"4px 0"}}>
                    <div className="tl-dot done">&#10003;</div>
                    <div className="tl-info">
                      <div className="tl-name" style={{color:"var(--green)"}}>Transacao privada concluida</div>
                      <div className="tl-detail">o destinatario pode sacar a qualquer momento</div>
                    </div>
                  </div>
                </div>
              )}

              {errorInfo && (
                <div className={`error-card${errorInfo.type==="warn"?" warn":""}`}>
                  <div className="error-card-title">
                    <span>{errorInfo.type==="warn"?"\u26A0":"\u2717"}</span>
                    {errorInfo.title}
                    <button className="error-dismiss" onClick={() => setErrorInfo(null)}>&times;</button>
                  </div>
                  <div className="error-card-desc">{errorInfo.desc}</div>
                  {errorInfo.action && <div className="error-card-action">{errorInfo.action}</div>}
                </div>
              )}
              {status && !errorInfo && !pipelineData && (
                <div className={`status-box${statusType?" "+statusType:""}`}>
                  <pre>{status}</pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============ TAB: RECEIVE ============ */}
        {tab === "receive" && (
          <div className="grid">
            <div className="left">
              <span className="sec-label">Fundos recebidos</span>
              <div className="card">
                <div className="card-body" style={{padding:"0 4px"}}>
                  {deposits.length === 0
                    ? <div className="hist-empty">{scanning ? "Escaneando blockchain..." : "Nenhum deposito encontrado"}</div>
                    : deposits.map(d => (
                      <div className="deposit-item" key={d.stealthAddress}>
                        <div className="deposit-header">
                          <span className="deposit-amt">{d.amount}</span>
                          <span className="deposit-token">{d.token}</span>
                          {d.isLocked && <span className="tier-badge tier-premium" style={{marginLeft:"8px",fontSize:"9px"}}>LOCKED</span>}
                        </div>
                        <div className="deposit-addr">{d.stealthAddress.slice(0,10)}...{d.stealthAddress.slice(-8)}</div>
                        {d.isLocked ? (
                          <div style={{fontSize:"11px",color:"var(--amber)",padding:"8px 0"}}>
                            Saque disponivel em {new Date(d.unlockAt * 1000).toLocaleString("pt-BR")}
                          </div>
                        ) : (
                          <button className="primary-btn" style={{padding:"10px",fontSize:"13px"}} onClick={() => withdraw(d)} disabled={withdrawing === d.stealthAddress}>
                            {withdrawing === d.stealthAddress ? "Sacando..." : "Sacar para minha carteira"}
                          </button>
                        )}
                      </div>
                    ))
                  }
                </div>
              </div>
              <div className="warning-box">
                <p>Suas chaves ficam salvas neste navegador. Use o backup com senha para nao perder o acesso se trocar de dispositivo.</p>
              </div>
            </div>

            {/* ---- RECEIVE FORM ---- */}
            <div className="form-card">
              <div className="form-title">Receber</div>
              <div className="form-sub">Compartilhe seu link — seu endereco real nunca aparece on-chain</div>
              {!myKeys ? (
                <>
                  <div className="no-keys">
                    <div className="no-keys-icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="currentColor" strokeWidth="1.5" fill="none" opacity=".6"/><path d="M12 7v10M7 9.5l10 5M17 9.5l-10 5" stroke="currentColor" strokeWidth="1" opacity=".3"/></svg>
                    </div>
                    <div className="no-keys-title">Crie seu link de pagamento</div>
                    <div className="no-keys-sub">Gere suas chaves uma vez e compartilhe o link com quem quiser te enviar fundos.</div>
                  </div>
                  <button className="primary-btn" onClick={generateKeys}>Gerar link de pagamento</button>
                  <button className="ghost-btn" onClick={openImport}>Restaurar backup</button>
                </>
              ) : (
                <>
                  <div className="link-box">
                    <div className="link-box-label">Seu link de pagamento</div>
                    <div className="link-url" onClick={copyLink}>{buildPayLink(myKeys.metaAddress)}</div>
                    <div className="link-actions">
                      <button className={`link-btn${linkCopied?" link-copied":""}`} onClick={copyLink}>
                        {linkCopied ? "Copiado!" : "Copiar link"}
                      </button>
                    </div>
                  </div>
                  <div className="sep" />
                  <button className="primary-btn" onClick={scan} disabled={scanning || !account}>
                    {scanning ? "Escaneando..." : "Verificar fundos recebidos"}
                  </button>
                  <button className="ghost-btn" onClick={openExport}>Backup com senha</button>
                  <button className="ghost-btn danger-btn" onClick={generateKeys} style={{marginTop:"6px"}}>Gerar novo link</button>
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

        {/* ============ TAB: ZK PRIVACY ============ */}
        {tab === "zk" && (
          <div className="grid">
            <div className="left">
              <span className="sec-label">Suas notas ZK</span>
              <div className="card">
                <div className="card-body" style={{padding:"0 4px"}}>
                  {zkNotes.length === 0
                    ? <div className="hist-empty">Nenhuma nota ZK. Faca um deposito para comecar.</div>
                    : zkNotes.map((note, idx) => (
                      <div className="deposit-item" key={note.commitment}>
                        <div className="deposit-header">
                          <span className="deposit-amt">{note.denomination}</span>
                          <span className="deposit-token">{note.token}</span>
                          <span className="tier-badge tier-premium" style={{marginLeft:"8px",fontSize:"9px"}}>ZK</span>
                        </div>
                        <div className="deposit-addr">nota #{note.leafIndex} · {new Date(note.timestamp).toLocaleDateString("pt-BR")}</div>
                        <button className="primary-btn" style={{padding:"10px",fontSize:"13px"}} onClick={() => zkWithdraw(note)} disabled={zkLoading}>
                          {zkLoading ? "Gerando prova..." : "Sacar anonimamente"}
                        </button>
                      </div>
                    ))
                  }
                </div>
              </div>

              {/* Backup/Import notas */}
              <div style={{display:"flex",gap:"8px"}}>
                <button className="ghost-btn" style={{marginTop:"0"}} onClick={exportZkNotes} disabled={zkNotes.length === 0}>Exportar notas</button>
                <label className="ghost-btn" style={{marginTop:"0",cursor:"pointer",textAlign:"center"}}>
                  Importar notas
                  <input type="file" accept=".json" style={{display:"none"}} onChange={e => importZkNotes(e.target.files[0])} />
                </label>
              </div>

              <div className="warning-box">
                <p>IMPORTANTE: Suas notas ZK sao a UNICA forma de sacar seus fundos. Faca backup! Se perder as notas, os fundos ficam travados para sempre.</p>
              </div>

              <div className="info-card">
                <div className="info-toggle" onClick={() => setAccordOpen(o => !o)}>
                  <span className="info-label">Como funciona o ZK Privacy</span>
                  <span className={`info-arrow${accordOpen?" open":""}`}>&#9660;</span>
                </div>
                <div className={`info-body${accordOpen?" open":""}`}>
                  {[
                    ["Commitment",      "hash(secret + nullifier)"],
                    ["Merkle tree",     "todos os deposits numa arvore"],
                    ["ZK Proof",        "prova sem revelar qual deposit"],
                    ["Nullifier",       "previne double-spend"],
                    ["Denominacoes",    "valores fixos = anonymity set"],
                    ["Privacidade",     "10/10 — link quebrado"],
                  ].map(([k,v]) => (
                    <div className="info-row" key={k}>
                      <span className="info-k">{k}</span>
                      <span className="info-v">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ---- ZK FORM ---- */}
            <div className="form-card">
              <div className="form-title">ZK Privacy</div>
              <div className="form-sub">Privacidade maxima — ninguem sabe qual deposito e seu</div>

              {/* Mode toggle */}
              <div className="toks" style={{marginBottom:"20px"}}>
                <button className={`tok${zkMode==="deposit"?" on":""}`} onClick={() => setZkMode("deposit")}>Depositar</button>
                <button className={`tok${zkMode==="withdraw"?" on":""}`} onClick={() => setZkMode("withdraw")}>Sacar</button>
              </div>

              {zkMode === "deposit" && (
                <>
                  <div className="toks">
                    {Object.keys(TOKENS).map(t => (
                      <button key={t} className={`tok${zkToken===t?" on":""}`} onClick={() => { setZkToken(t); setZkDenom(""); }}>{t}</button>
                    ))}
                  </div>
                  <div style={{fontSize:"11px",color:"var(--text3)",marginBottom:"12px",textTransform:"uppercase",letterSpacing:"1px",fontWeight:"600"}}>Denominacao (valor fixo)</div>
                  <div className="denom-grid">
                    {ZK_DENOMS[zkToken].map(d => (
                      <button key={d} className={`denom-btn${zkDenom===d?" on":""}`} onClick={() => setZkDenom(d)}>
                        {d} {zkToken}
                      </button>
                    ))}
                  </div>
                  <div className="sep" />
                  <button className="primary-btn" onClick={zkDeposit} disabled={zkLoading || !account || !zkDenom}>
                    {zkLoading ? "Processando..." : "Depositar com ZK"}
                  </button>
                  <div style={{textAlign:"center",marginTop:"10px",fontSize:"11px",color:"var(--text3)"}}>
                    Sem taxa de privacidade no modo ZK
                  </div>
                </>
              )}

              {zkMode === "withdraw" && (
                <>
                  {zkNotes.length === 0 ? (
                    <div className="no-keys">
                      <div className="no-keys-icon" style={{background:"rgba(251,191,36,.08)",borderColor:"rgba(251,191,36,.12)"}}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="currentColor" strokeWidth="1.5" fill="none" opacity=".6"/></svg>
                      </div>
                      <div className="no-keys-title">Nenhuma nota ZK</div>
                      <div className="no-keys-sub">Faca um deposito ZK primeiro, ou importe notas de um backup.</div>
                    </div>
                  ) : (
                    <>
                      <div style={{fontSize:"11px",color:"var(--text3)",marginBottom:"12px",textTransform:"uppercase",letterSpacing:"1px",fontWeight:"600"}}>Selecione a nota para sacar</div>
                      {zkNotes.map((note, idx) => (
                        <div key={note.commitment} className="denom-toggle" onClick={() => setZkWithdrawNote(note)} style={{marginBottom:"8px",borderColor: zkWithdrawNote?.commitment === note.commitment ? "var(--accent)" : ""}}>
                          <div style={{flex:1}}>
                            <div style={{fontSize:"14px",fontWeight:"600"}}>{note.denomination} {note.token}</div>
                            <div style={{fontSize:"10px",color:"var(--text3)",fontFamily:"var(--mono)"}}>nota #{note.leafIndex}</div>
                          </div>
                          {zkWithdrawNote?.commitment === note.commitment && <span style={{color:"var(--accent)",fontSize:"14px"}}>&#10003;</span>}
                        </div>
                      ))}
                      <div className="fld" style={{marginTop:"16px"}}>
                        <label>Endereco destino (deixe vazio para sua carteira)</label>
                        <input type="text" placeholder={account || "0x..."} value={zkRecipient} onChange={e => setZkRecipient(e.target.value)} />
                      </div>
                      <button className="primary-btn" onClick={() => zkWithdrawNote && zkWithdraw(zkWithdrawNote)} disabled={zkLoading || !zkWithdrawNote || !account}>
                        {zkLoading ? "Gerando prova ZK..." : "Sacar anonimamente"}
                      </button>
                    </>
                  )}
                </>
              )}

              {zkStatus && (
                <div className={`status-box${zkStatus.includes("concluido") || zkStatus.includes("salva") ? " ok" : zkStatus.includes("Erro") ? " err" : ""}`} style={{marginTop:"14px"}}>
                  <pre>{zkStatus}</pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---- FOOTER ---- */}
        <footer className="footer">
          <span className="footer-l">SILENTFLOW</span>
          <div className="footer-r">
            <a className="footer-link" href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Contrato</a>
            <a className="footer-link" href="https://silentflow-landing-wine.vercel.app" target="_blank" rel="noreferrer">Pagina inicial</a>
          </div>
        </footer>
      </div>
    </>
  );
}
