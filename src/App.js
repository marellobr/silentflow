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
  "function withdrawNonces(address) external view returns (uint256)",
  "event StealthDeposit(bytes ephemeralPubKey, address indexed stealthAddress, address token, uint256 amount, uint8 viewTag, bool timelocked, uint256 unlockAt)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

const TOKENS = {
  ETH:  { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  USDT: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 }
};

const DENOMS = {
  ETH:  [0.01, 0.05, 0.1, 0.5, 1, 5],
  USDC: [10, 50, 100, 500, 1000],
  USDT: [10, 50, 100, 500, 1000]
};

function getTierInfo(usd) {
  if (usd >= 5000) return { label: "Premium", bps: 10, color: "#a78bfa" };
  if (usd >= 500)  return { label: "Volume",  bps: 15, color: "#34d399" };
  return                  { label: "Standard", bps: 20, color: "#22b8e6" };
}

function fmt(addr) {
  if (!addr) return "";
  return addr.slice(0, 8) + "..." + addr.slice(-6);
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

const S = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#08090d;--bg2:#0d0f18;--surface:#111520;--surface2:#181c2e;
  --border:rgba(255,255,255,0.06);--border2:rgba(255,255,255,0.1);
  --accent:#22c5f0;--accent2:#5dd8f8;--accent-dim:rgba(34,197,240,0.1);--accent-glow:rgba(34,197,240,0.2);
  --green:#34d399;--green-dim:rgba(52,211,153,0.1);
  --amber:#fbbf24;--red:#f87171;--red-dim:rgba(248,113,113,0.1);--purple:#a78bfa;
  --text:#f0f4ff;--text2:#94a3b8;--text3:#475569;
  --sans:'DM Sans',sans-serif;--mono:'JetBrains Mono',monospace;
  --r:16px;--r2:10px;--r3:8px;
}
html,body,#root{height:100%}
body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}
button{cursor:pointer;font-family:var(--sans);outline:none}
input,textarea{font-family:var(--sans);outline:none}
a{color:var(--accent);text-decoration:none}
.app{min-height:100vh;display:flex;flex-direction:column;padding-bottom:80px}
.app-glow{position:fixed;top:-200px;left:50%;transform:translateX(-50%);width:800px;height:500px;border-radius:50%;background:radial-gradient(ellipse,rgba(34,197,240,0.04) 0%,transparent 70%);pointer-events:none;z-index:0}

/* NAV */
.nav{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:rgba(8,9,13,0.85);backdrop-filter:blur(24px);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:50}
.nav-brand{display:flex;align-items:center;gap:10px}
.nav-logo-img{width:26px;height:26px;filter:drop-shadow(0 0 10px var(--accent-glow))}
.nav-logo-text{font-size:14px;font-weight:600;letter-spacing:0.06em;color:#fff}
.nav-badge{font-family:var(--mono);font-size:9px;letter-spacing:0.06em;color:var(--green);background:var(--green-dim);border:1px solid rgba(52,211,153,0.2);padding:3px 8px;border-radius:20px;display:flex;align-items:center;gap:5px}
.nav-badge::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--green);animation:blink 2s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
.nav-right{display:flex;align-items:center;gap:10px}
.nav-lang{background:transparent;border:1px solid var(--border2);color:var(--text2);font-size:11px;font-weight:500;padding:5px 10px;border-radius:20px;transition:all 0.2s}
.nav-lang:hover{border-color:var(--accent);color:var(--accent)}
.nav-connect{background:var(--accent);color:#08090d;font-weight:600;font-size:13px;padding:8px 18px;border-radius:var(--r2);border:none;transition:all 0.2s;box-shadow:0 0 20px var(--accent-glow)}
.nav-connect:hover{opacity:0.9;transform:translateY(-1px)}
.nav-wallet{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border2);padding:7px 14px;border-radius:20px;font-family:var(--mono);font-size:11px;color:var(--accent2)}
.wallet-dot{width:6px;height:6px;border-radius:50%;background:var(--green)}

/* MAIN */
.main{flex:1;max-width:960px;margin:0 auto;width:100%;padding:28px 20px 0;position:relative;z-index:1}

/* TABS */
.tabs-wrap{display:flex;gap:3px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:4px;margin-bottom:24px}
.tab-btn{flex:1;padding:10px 8px;border:none;border-radius:var(--r2);background:transparent;color:var(--text3);font-size:13px;font-weight:500;transition:all 0.22s;display:flex;align-items:center;justify-content:center;gap:6px}
.tab-btn:hover{color:var(--text2)}
.tab-btn.active{background:var(--surface2);color:var(--accent);border:1px solid rgba(34,197,240,0.15);box-shadow:0 2px 12px rgba(34,197,240,0.08)}
.tab-icon{font-size:15px}
@media(max-width:680px){
  .section-grid{grid-template-columns:1fr!important}
  .app{padding-bottom:90px}
  .tabs-wrap{position:fixed;bottom:0;left:0;right:0;z-index:50;border-radius:0;border-left:none;border-right:none;border-bottom:none;border-top:1px solid var(--border);background:rgba(8,9,13,0.95);backdrop-filter:blur(20px);margin-bottom:0;padding:8px 12px 12px}
  .tab-btn{flex-direction:column;gap:3px;font-size:10px;padding:8px 4px}
  .tab-icon{font-size:18px}
}

/* GRID */
.section-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}

/* CARD */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:22px}
.card-title{font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--text3);margin-bottom:18px}
.card-subtitle{font-size:13px;color:var(--text2);margin-bottom:20px;line-height:1.6}

/* TOKEN SELECTOR */
.token-row{display:flex;gap:6px;margin-bottom:18px}
.token-btn{flex:1;padding:9px 6px;border:1px solid var(--border);border-radius:var(--r2);background:transparent;color:var(--text2);font-size:13px;font-weight:600;transition:all 0.2s}
.token-btn:hover{border-color:var(--border2);color:var(--text)}
.token-btn.active{background:var(--accent-dim);border-color:rgba(34,197,240,0.3);color:var(--accent)}

/* AMOUNT */
.amount-wrap{position:relative;margin-bottom:16px}
.amount-input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2);padding:14px 70px 14px 16px;color:var(--text);font-size:22px;font-weight:500;transition:border-color 0.2s}
.amount-input:focus{border-color:rgba(34,197,240,0.4)}
.amount-input::placeholder{color:var(--text3)}
.amount-token{position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:13px;font-weight:600;color:var(--text2);font-family:var(--mono)}

/* DENOM */
.denom-wrap{margin-bottom:16px}
.denom-label{font-size:12px;color:var(--text3);margin-bottom:8px;font-weight:500}
.denom-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.denom-btn{padding:9px 6px;border:1px solid var(--border);border-radius:var(--r2);background:transparent;color:var(--text2);font-size:12px;font-family:var(--mono);font-weight:500;transition:all 0.2s}
.denom-btn:hover{border-color:var(--border2);color:var(--text)}
.denom-btn.active{background:var(--accent-dim);border-color:rgba(34,197,240,0.3);color:var(--accent)}

/* FIELD */
.field-label{font-size:12px;color:var(--text3);margin-bottom:7px;font-weight:500;display:block}
.field-input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2);padding:11px 14px;color:var(--text);font-size:13px;transition:border-color 0.2s}
.field-input:focus{border-color:rgba(34,197,240,0.4)}
.field-input::placeholder{color:var(--text3)}
.field-hint{font-size:11px;color:var(--text3);margin-top:5px}

/* OPTIONS CHIPS */
.options-row{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
.option-chip{display:flex;align-items:center;gap:7px;padding:8px 14px;border-radius:20px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:12px;font-weight:500;transition:all 0.2s;cursor:pointer}
.option-chip:hover{border-color:var(--border2);color:var(--text)}
.option-chip.active{background:var(--accent-dim);border-color:rgba(34,197,240,0.3);color:var(--accent)}
.chip-check{width:16px;height:16px;border-radius:50%;border:1.5px solid currentColor;display:flex;align-items:center;justify-content:center;font-size:9px;flex-shrink:0}
.chip-check.on{background:var(--accent);border-color:var(--accent);color:#08090d}

/* FEE */
.fee-row{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:var(--r2);background:var(--surface2);border:1px solid var(--border);margin-bottom:16px;font-size:12px}
.fee-label{color:var(--text3)}
.fee-value{font-weight:600;font-family:var(--mono)}

/* BUTTONS */
.btn-primary{width:100%;padding:14px;border:none;border-radius:var(--r);background:var(--accent);color:#08090d;font-size:15px;font-weight:700;transition:all 0.22s;box-shadow:0 0 24px var(--accent-glow);display:flex;align-items:center;justify-content:center;gap:8px}
.btn-primary:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 4px 32px var(--accent-glow)}
.btn-primary:disabled{opacity:0.45;cursor:not-allowed;transform:none}
.btn-secondary{width:100%;padding:11px;border:1px solid var(--border2);border-radius:var(--r);background:transparent;color:var(--text2);font-size:14px;font-weight:500;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px}
.btn-secondary:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
.btn-secondary:disabled{opacity:0.4;cursor:not-allowed}

/* PIPELINE */
.pipeline{background:var(--surface2);border:1px solid rgba(34,197,240,0.15);border-radius:var(--r);padding:18px;margin-top:14px}
.pipeline-title{font-size:11px;color:var(--text3);font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:14px}
.pipeline-steps{display:flex;flex-direction:column;gap:8px}
.pipe-step{display:flex;align-items:center;gap:12px}
.pipe-dot{width:24px;height:24px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px}
.pipe-dot.done{background:var(--green-dim);color:var(--green);border:1px solid rgba(52,211,153,0.3)}
.pipe-dot.active{background:var(--accent-dim);color:var(--accent);border:1px solid rgba(34,197,240,0.3);animation:pulse-ring 1.5s infinite}
.pipe-dot.wait{background:var(--surface);color:var(--text3);border:1px solid var(--border)}
.pipe-label{font-size:13px;color:var(--text2)}
.pipe-label.active{color:var(--text)}
@keyframes pulse-ring{0%,100%{box-shadow:0 0 0 0 rgba(34,197,240,0.3)}50%{box-shadow:0 0 0 5px rgba(34,197,240,0)}}

/* HISTORY */
.history-empty{padding:36px 20px;text-align:center;color:var(--text3);font-size:13px}
.history-empty-icon{font-size:32px;margin-bottom:10px;opacity:0.4}
.history-list{display:flex;flex-direction:column}
.history-row{display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--border)}
.history-row:last-child{border-bottom:none}
.history-ico{width:34px;height:34px;border-radius:50%;background:var(--accent-dim);border:1px solid rgba(34,197,240,0.15);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--accent);flex-shrink:0}
.history-body{flex:1;min-width:0}
.history-amount{font-size:14px;font-weight:600;color:var(--text)}
.history-dest{font-size:11px;color:var(--text3);font-family:var(--mono);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history-link{font-size:11px;color:var(--accent);margin-top:2px;display:block}
.history-badge{font-size:10px;padding:3px 8px;border-radius:20px;white-space:nowrap;flex-shrink:0}
.badge-pending{background:var(--accent-dim);color:var(--accent);border:1px solid rgba(34,197,240,0.2)}
.badge-done{background:var(--green-dim);color:var(--green);border:1px solid rgba(52,211,153,0.2)}

/* RECEIVE */
.receive-address-card{background:var(--surface2);border:1px solid rgba(34,197,240,0.15);border-radius:var(--r);padding:20px;margin-bottom:14px;position:relative;overflow:hidden}
.receive-address-card::before{content:'';position:absolute;top:-30px;right:-30px;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,rgba(34,197,240,0.06),transparent 70%)}
.receive-label{font-size:11px;color:var(--text3);font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px}
.receive-addr-display{font-family:var(--mono);font-size:12px;color:var(--accent2);word-break:break-all;line-height:1.6;margin-bottom:14px;padding:12px;background:rgba(0,0,0,0.2);border-radius:var(--r3);border:1px solid var(--border)}
.copy-btn{padding:8px 18px;border:1px solid rgba(34,197,240,0.3);border-radius:20px;background:var(--accent-dim);color:var(--accent);font-size:12px;font-weight:600;transition:all 0.2s;cursor:pointer}
.copy-btn:hover{background:var(--accent);color:#08090d}
.copy-btn.copied{background:var(--green-dim);border-color:rgba(52,211,153,0.3);color:var(--green)}

.key-row{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-radius:var(--r2);background:var(--surface2);border:1px solid var(--border);margin-bottom:8px}
.key-row-label{font-size:12px;color:var(--text3);font-weight:500}
.key-row-value{font-family:var(--mono);font-size:11px;color:var(--text2);filter:blur(5px);transition:filter 0.2s;cursor:pointer;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.key-row-value:hover{filter:none}

.paylink-section{margin-top:16px;padding:16px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r)}
.paylink-label{font-size:11px;color:var(--text3);font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px}
.paylink-url{font-family:var(--mono);font-size:11px;color:var(--text3);word-break:break-all;margin-bottom:12px;line-height:1.5}
.action-row{display:flex;gap:8px;margin-top:14px}
.action-btn{flex:1;padding:9px;border:1px solid var(--border2);border-radius:var(--r2);background:transparent;color:var(--text2);font-size:12px;font-weight:500;transition:all 0.2s;cursor:pointer}
.action-btn:hover{border-color:var(--accent);color:var(--accent)}

/* SCAN */
.scan-hero{text-align:center;padding:8px 0 24px}
.scan-hero-icon{font-size:48px;margin-bottom:12px;filter:drop-shadow(0 0 16px var(--accent-glow))}
.scan-hero-title{font-size:18px;font-weight:600;color:var(--text);margin-bottom:6px}
.scan-hero-sub{font-size:13px;color:var(--text2);max-width:320px;margin:0 auto}
.scan-result-card{background:var(--surface2);border:1px solid rgba(52,211,153,0.2);border-radius:var(--r);padding:16px;margin-top:14px}
.scan-result-header{font-size:12px;color:var(--green);font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:6px}
.scan-item{padding:12px 0;border-bottom:1px solid var(--border)}
.scan-item:last-child{border-bottom:none}
.scan-item-amount{font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px}
.scan-item-addr{font-family:var(--mono);font-size:11px;color:var(--text3)}
.scan-item-locked{font-size:11px;color:var(--amber);margin-top:4px}
.scan-item-link{font-size:11px;color:var(--accent);margin-top:4px;display:block}

/* WITHDRAW */
.withdraw-item{background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:18px;margin-bottom:12px}
.withdraw-amount{font-size:22px;font-weight:700;color:var(--text);margin-bottom:4px}
.withdraw-addr{font-family:var(--mono);font-size:11px;color:var(--text3);margin-bottom:12px;word-break:break-all}
.withdraw-status{font-size:11px;margin-bottom:12px;display:flex;align-items:center;gap:5px}
.status-unlocked{color:var(--green)}
.status-locked{color:var(--amber)}

/* HOW */
.how-card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:20px}
.how-title{font-size:12px;color:var(--text3);font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:16px}
.how-steps{display:flex;flex-direction:column}
.how-step{display:flex;gap:14px;padding:13px 0;border-bottom:1px solid var(--border)}
.how-step:last-child{border-bottom:none}
.how-num{width:24px;height:24px;border-radius:50%;flex-shrink:0;margin-top:1px;background:var(--accent-dim);border:1px solid rgba(34,197,240,0.2);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:10px;color:var(--accent)}
.how-step-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px}
.how-step-desc{font-size:12px;color:var(--text3);line-height:1.6}

/* ALERTS */
.alert{padding:12px 16px;border-radius:var(--r2);font-size:13px;margin-bottom:14px;line-height:1.5}
.alert-error{background:var(--red-dim);border:1px solid rgba(248,113,113,0.2);color:var(--red)}
.alert-success{background:var(--green-dim);border:1px solid rgba(52,211,153,0.2);color:var(--green)}
.alert-info{background:var(--accent-dim);border:1px solid rgba(34,197,240,0.2);color:var(--accent2)}
.alert-warn{background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);color:var(--amber)}

/* MODAL */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px}
.modal{background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);padding:28px;width:100%;max-width:400px;animation:modal-in 0.25s ease}
@keyframes modal-in{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.modal-title{font-size:16px;font-weight:600;color:var(--text);margin-bottom:20px}
.modal-field{margin-bottom:14px}
.modal-label{font-size:12px;color:var(--text3);margin-bottom:6px;font-weight:500;display:block}
.modal-input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2);padding:10px 14px;color:var(--text);font-size:14px}
.modal-input:focus{border-color:rgba(34,197,240,0.4);outline:none}
.modal-actions{display:flex;gap:10px;margin-top:20px}
.modal-cancel{flex:1;padding:10px;border:1px solid var(--border);border-radius:var(--r2);background:transparent;color:var(--text2);font-size:13px;font-weight:500;cursor:pointer;transition:all 0.2s}
.modal-cancel:hover{border-color:var(--border2);color:var(--text)}
.modal-confirm{flex:1;padding:10px;border:none;border-radius:var(--r2);background:var(--accent);color:#08090d;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.2s}
.modal-confirm:hover{opacity:0.9}

/* NOTIF */
.notif-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;margin-bottom:16px;background:var(--surface2);border:1px solid rgba(34,197,240,0.15);border-radius:var(--r2);font-size:13px;color:var(--text2)}
.notif-btn{padding:5px 12px;border:1px solid rgba(34,197,240,0.3);border-radius:20px;background:transparent;color:var(--accent);font-size:11px;font-weight:600;white-space:nowrap;transition:all 0.2s;cursor:pointer}
.notif-btn:hover{background:var(--accent);color:#08090d}

/* SPINNER */
.spin{width:16px;height:16px;border:2px solid rgba(8,9,13,0.3);border-top-color:#08090d;border-radius:50%;animation:spinning 0.65s linear infinite;display:inline-block}
@keyframes spinning{to{transform:rotate(360deg)}}

/* EMPTY */
.empty-state{text-align:center;padding:48px 20px}
.empty-icon{font-size:40px;margin-bottom:12px;opacity:0.35}
.empty-title{font-size:15px;font-weight:600;color:var(--text2);margin-bottom:6px}
.empty-desc{font-size:13px;color:var(--text3);margin-bottom:20px}

@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.fade{animation:fadeUp 0.35s ease both}
`;

const T = {
  pt: {
    send:"Enviar",receive:"Receber",scan:"Recebidos",withdraw:"Sacar",
    sendDesc:"Seus fundos chegam sem revelar sua identidade.",
    amount:"Valor",to:"Enviar para",toHint:"Cole o endereço ou link de pagamento do destinatário",
    fixedDenom:"Valor padronizado",fixedDenomDesc:"mais privacidade",
    timelock:"Atraso 6h",timelockDesc:"máxima privacidade",
    sendBtn:"Enviar com privacidade",sending:"Processando...",
    fee:"Taxa de privacidade",history:"Histórico",
    noHistory:"Nenhum envio ainda",noHistoryDesc:"Seus envios privados aparecerão aqui.",
    basescan:"Ver no Basescan",
    receiveAddress:"Seu endereço de recebimento",
    receiveDesc:"Compartilhe para receber pagamentos privados.",
    spendKey:"Chave de acesso",viewKey:"Chave de visualização",
    keysHint:"Passe o mouse para revelar. Nunca compartilhe.",
    paylink:"Link de pagamento",paylinkDesc:"Compartilhe — quem clicar pode te pagar diretamente.",
    copy:"Copiar",copied:"Copiado!",copyLink:"Copiar link",
    exportKeys:"Fazer backup",generateKeys:"Novo endereço",
    noKeys:"Você ainda não tem endereço de recebimento.",
    noKeysDesc:"Crie um endereço para receber pagamentos privados.",
    generateBtn:"Criar endereço de recebimento",
    importKeys:"Importar backup",backupDesc:"Restaure suas chaves a partir de um backup.",
    scanTitle:"Verificar pagamentos recebidos",
    scanDesc:"Verifique se você recebeu algum pagamento privado.",
    scanBtn:"Verificar agora",scanning:"Verificando...",
    scanFound:"pagamento(s) encontrado(s)",scanEmpty:"Nenhum pagamento encontrado.",
    howScan:"Como funciona",
    how1t:"Busca na blockchain",how1d:"Analisa os eventos recentes do contrato SilentFlow.",
    how2t:"Descriptografia local",how2d:"Suas chaves ficam no browser. Nunca saem do dispositivo.",
    how3t:"100% privado",how3d:"Ninguém sabe que você está verificando.",
    withdrawTitle:"Sacar para sua carteira",
    withdrawDesc:"Transfira pagamentos recebidos para sua carteira.",
    withdrawBtn:"Sacar agora",withdrawing:"Sacando...",
    noWithdraw:"Nenhum pagamento para sacar.",
    noWithdrawDesc:"Vá para Recebidos e verifique primeiro.",
    goScan:"Verificar recebimentos",
    unlocked:"Disponível para saque",locked:"Bloqueado até",
    gasless:"Saque sem gas",gaslessDesc:"Você não precisa de ETH para sacar. O protocolo cobre o gas.",
    connect:"Conectar carteira",connecting:"Conectando...",
    wrongNetwork:"Mude para a rede Base no MetaMask.",
    exportTitle:"Backup das chaves (AES-256)",
    password:"Senha",confirm:"Confirmar",cancel:"Cancelar",
    notifAsk:"Ative notificações para saber quando seu envio for concluído.",
    notifBtn:"Ativar",
    pipeline:"Processando envio privado",
    pipe1:"Entrada recebida",pipe2:"Dividindo em partes",pipe3:"Roteando entre carteiras",pipe4:"Depositado com privacidade",
    invalidRecipient:"Destinatário inválido.",enterAmount:"Informe o valor.",enterRecipient:"Informe o destinatário.",
    sent:"Enviado! Processando...",txComplete:"✓ Transação concluída!",
    importedKeys:"Chaves importadas!",wrongPwd:"Senha incorreta ou arquivo inválido.",
    noKeysForScan:"Crie seu endereço de recebimento primeiro.",
    withdrawSuccess:"Saque realizado!",contractVerified:"Contrato verificado na Base",
  },
  en: {
    send:"Send",receive:"Receive",scan:"Received",withdraw:"Withdraw",
    sendDesc:"Your funds arrive without revealing your identity.",
    amount:"Amount",to:"Send to",toHint:"Paste the recipient address or payment link",
    fixedDenom:"Standard amount",fixedDenomDesc:"more privacy",
    timelock:"6h delay",timelockDesc:"maximum privacy",
    sendBtn:"Send privately",sending:"Processing...",
    fee:"Privacy fee",history:"History",
    noHistory:"No transfers yet",noHistoryDesc:"Your private transfers will appear here.",
    basescan:"View on Basescan",
    receiveAddress:"Your receiving address",
    receiveDesc:"Share this to receive private payments.",
    spendKey:"Spending key",viewKey:"Viewing key",
    keysHint:"Hover to reveal. Never share.",
    paylink:"Payment link",paylinkDesc:"Share this — anyone who clicks can pay you privately.",
    copy:"Copy",copied:"Copied!",copyLink:"Copy link",
    exportKeys:"Backup keys",generateKeys:"New address",
    noKeys:"You don't have a receiving address yet.",
    noKeysDesc:"Create an address to receive private payments.",
    generateBtn:"Create receiving address",
    importKeys:"Import backup",backupDesc:"Restore your keys from a backup file.",
    scanTitle:"Check received payments",
    scanDesc:"Check if you have received any private payment.",
    scanBtn:"Check now",scanning:"Checking...",
    scanFound:"payment(s) found",scanEmpty:"No payments found.",
    howScan:"How it works",
    how1t:"Blockchain scan",how1d:"Analyses recent events from the SilentFlow contract.",
    how2t:"Local decryption",how2d:"Your keys stay in the browser. Never leave your device.",
    how3t:"100% private",how3d:"Nobody knows you are checking.",
    withdrawTitle:"Withdraw to your wallet",
    withdrawDesc:"Transfer received payments to your wallet.",
    withdrawBtn:"Withdraw now",withdrawing:"Withdrawing...",
    noWithdraw:"No payments to withdraw.",
    noWithdrawDesc:"Go to Received and check first.",
    goScan:"Check received",
    unlocked:"Available to withdraw",locked:"Locked until",
    gasless:"Gasless withdrawal",gaslessDesc:"You don't need ETH to withdraw. The protocol covers gas.",
    connect:"Connect wallet",connecting:"Connecting...",
    wrongNetwork:"Switch to Base network in MetaMask.",
    exportTitle:"Key backup (AES-256)",
    password:"Password",confirm:"Confirm",cancel:"Cancel",
    notifAsk:"Enable notifications to know when your transfer is complete.",
    notifBtn:"Enable",
    pipeline:"Processing private transfer",
    pipe1:"Entry received",pipe2:"Splitting into parts",pipe3:"Routing through wallets",pipe4:"Deposited privately",
    invalidRecipient:"Invalid recipient.",enterAmount:"Enter an amount.",enterRecipient:"Enter a recipient.",
    sent:"Sent! Processing...",txComplete:"✓ Transaction complete!",
    importedKeys:"Keys imported!",wrongPwd:"Wrong password or invalid file.",
    noKeysForScan:"Create your receiving address first.",
    withdrawSuccess:"Withdrawal successful!",contractVerified:"Verified contract on Base",
  }
};

export default function App() {
  const [lang, setLang]             = useState("pt");
  const t = T[lang];
  const [account, setAccount]       = useState("");
  const [tab, setTab]               = useState("send");
  const [token, setToken]           = useState("ETH");
  const [amount, setAmount]         = useState("");
  const [recipient, setRecipient]   = useState("");
  const [useFixed, setUseFixed]     = useState(false);
  const [useLock, setUseLock]       = useState(false);
  const [selDenom, setSelDenom]     = useState(null);
  const [loading, setLoading]       = useState(false);
  const [alert, setAlert]           = useState(null);
  const [history, setHistory]       = useState([]);
  const [pipelineId, setPipelineId] = useState(null);
  const [pipeData, setPipeData]     = useState(null);
  const [notifPerm, setNotifPerm]   = useState(Notification?.permission || "default");
  const [sk, setSk]                 = useState("");
  const [vk, setVk]                 = useState("");
  const [meta, setMeta]             = useState("");
  const [payLink, setPayLink]       = useState("");
  const [copied, setCopied]         = useState("");
  const [scanResults, setScanResults] = useState([]);
  const [scanning, setScanning]     = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportPwd, setExportPwd]   = useState("");
  const [importData, setImportData] = useState("");
  const [importPwd, setImportPwd]   = useState("");

  useEffect(() => {
    const s = localStorage.getItem("sf_sk");
    const v = localStorage.getItem("sf_vk");
    if (s && v) { setSk(s); setVk(v); buildMeta(s, v); }
    const h = localStorage.getItem("sf_hist");
    if (h) setHistory(JSON.parse(h));
  }, []);

  useEffect(() => {
    const m = window.location.pathname.match(/\/p\/(st:.+)/);
    if (m) { setRecipient(decodeURIComponent(m[1])); setTab("send"); }
  }, []);

  useEffect(() => {
    if (!pipelineId) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/status/${pipelineId}`);
        const d = await r.json();
        setPipeData(d);
        if (d.status === "completo") {
          clearInterval(iv);
          setPipelineId(null);
          if (Notification?.permission === "granted") new Notification("SilentFlow", { body: t.txComplete, icon:"/logo.png" });
          showAlert(t.txComplete, "success");
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
      const m  = `st:${sp}:${vp}`;
      setMeta(m);
      setPayLink(`${window.location.origin}/p/${encodeURIComponent(m)}`);
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

  function showAlert(msg, type="info") {
    setAlert({msg,type});
    setTimeout(() => setAlert(null), 6000);
  }

  function copyText(text, key) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  }

  async function connect() {
    if (!window.ethereum) return alert("MetaMask não encontrado.");
    setLoading(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== BASE_CHAIN_ID) {
        try { await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{chainId:"0x2105"}] }); }
        catch { showAlert(t.wrongNetwork,"error"); setLoading(false); return; }
      }
      const accs = await provider.send("eth_requestAccounts",[]);
      setAccount(accs[0]);
    } catch(e) { showAlert(e.message,"error"); }
    setLoading(false);
  }

  function getTier() {
    const v = useFixed ? (selDenom||0) : (parseFloat(amount)||0);
    const usd = token==="ETH" ? v*3000 : v;
    return getTierInfo(usd);
  }

  async function send() {
    if (!account) return connect();
    const val = useFixed ? selDenom : parseFloat(amount);
    if (!val || val<=0) return showAlert(t.enterAmount,"error");
    if (!recipient.trim()) return showAlert(t.enterRecipient,"error");
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
      const er = await fetch(`${BACKEND_URL}/entrada?${params}`);
      const ed = await er.json();
      if (ed.erro) throw new Error(ed.erro);
      if (!ed.entradaAddress) throw new Error("Backend error.");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const decimals = TOKENS[token].decimals;
      const valBig = ethers.parseUnits(val.toString(), decimals);
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
      try {
        const ar = await fetch(`${BACKEND_URL}/aguardar/${ed.entradaAddress}`);
        const ad = await ar.json();
        if (ad.pipelineId) setPipelineId(ad.pipelineId);
      } catch {}
    } catch(e) { showAlert(e.message||"Erro.","error"); }
    setLoading(false);
  }

  async function scan() {
    if (!sk||!vk) return showAlert(t.noKeysForScan,"error");
    setScanning(true); setScanResults([]);
    try {
      const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
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
            const [eph,sAddr,tAddr,amt,vt,tl,ua] = ev.args;
            const res = tryDecrypt(eph,sAddr,Number(vt),sk,vk);
            if (res) {
              const sym = Object.keys(TOKENS).find(k=>TOKENS[k].address.toLowerCase()===tAddr.toLowerCase())||"?";
              const dec = TOKENS[sym]?.decimals||18;
              found.push({ stealthAddress:res.stealthAddress, stealthPrivKey:res.stealthPrivKey, token:sym, tokenAddr:tAddr, amount:ethers.formatUnits(amt,dec), timelocked:tl, unlockAt:Number(ua), txHash:ev.transactionHash });
            }
          }
        } catch {}
      }
      setScanResults(found);
      if (!found.length) showAlert(t.scanEmpty,"info");
    } catch(e) { showAlert(e.message,"error"); }
    setScanning(false);
  }

  async function doWithdraw(item) {
    if (!account) return connect();
    setLoading(true);
    try {
      const sw = new ethers.Wallet(item.stealthPrivKey);
      const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
      const nonce = await contract.withdrawNonces(item.stealthAddress);
      const packed = ethers.keccak256(ethers.solidityPacked(["address","address","address","uint256","uint256"],[item.stealthAddress,item.tokenAddr,account,nonce,BigInt(BASE_CHAIN_ID)]));
      const sig = await sw.signMessage(ethers.getBytes(packed));
      const res = await fetch(`${BACKEND_URL}/withdraw`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stealthAddress:item.stealthAddress,token:item.tokenAddr,recipient:account,sig})});
      const d = await res.json();
      if (d.ok) { showAlert(t.withdrawSuccess,"success"); setScanResults(prev=>prev.filter(r=>r.stealthAddress!==item.stealthAddress)); }
      else showAlert(d.error||"Erro.","error");
    } catch(e) { showAlert(e.message,"error"); }
    setLoading(false);
  }

  async function handleExport() {
    if (!exportPwd) return;
    const enc = await encryptKeys({sk,vk}, exportPwd);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([enc],{type:"text/plain"}));
    a.download = "silentflow-backup.enc"; a.click();
    setShowExport(false); setExportPwd("");
  }

  async function handleImport() {
    if (!importData||!importPwd) return;
    try {
      const {sk:s,vk:v} = await decryptKeys(importData.trim(),importPwd);
      setSk(s); setVk(v);
      localStorage.setItem("sf_sk",s); localStorage.setItem("sf_vk",v);
      buildMeta(s,v);
      setImportData(""); setImportPwd("");
      showAlert(t.importedKeys,"success");
    } catch { showAlert(t.wrongPwd,"error"); }
  }

  const pipeSteps = [t.pipe1,t.pipe2,t.pipe3,t.pipe4];
  const pipeOrder = ["recebido","splitting","hops","completo"];
  function pipeStatus(i) {
    if (!pipeData) return "wait";
    const ci = pipeOrder.indexOf(pipeData.status);
    if (i<ci) return "done";
    if (i===ci) return "active";
    return "wait";
  }

  const tier = getTier();

  return (
    <>
      <style>{S}</style>
      <div className="app-glow" />
      <div className="app">
        <nav className="nav">
          <div className="nav-brand">
            <img className="nav-logo-img" src="/logo.png" alt="SF" onError={e=>e.target.style.display="none"} />
            <span className="nav-logo-text">SILENTFLOW</span>
            <span className="nav-badge">BASE MAINNET</span>
          </div>
          <div className="nav-right">
            <button className="nav-lang" onClick={()=>setLang(l=>l==="pt"?"en":"pt")}>{lang==="pt"?"EN":"PT"}</button>
            {account
              ? <div className="nav-wallet"><span className="wallet-dot"/>{fmt(account)}</div>
              : <button className="nav-connect" onClick={connect} disabled={loading}>{loading?t.connecting:t.connect}</button>
            }
          </div>
        </nav>

        <main className="main">
          {notifPerm==="default" && (
            <div className="notif-bar fade">
              <span>{t.notifAsk}</span>
              <button className="notif-btn" onClick={async()=>setNotifPerm(await Notification?.requestPermission())}>{t.notifBtn}</button>
            </div>
          )}
          {alert && <div className={`alert alert-${alert.type} fade`}>{alert.msg}</div>}

          <div className="tabs-wrap">
            {[{key:"send",icon:"↗",label:t.send},{key:"receive",icon:"⬇",label:t.receive},{key:"scan",icon:"⬡",label:t.scan},{key:"withdraw",icon:"💳",label:t.withdraw}].map(({key,icon,label})=>(
              <button key={key} className={`tab-btn ${tab===key?"active":""}`} onClick={()=>{setTab(key);setAlert(null);}}>
                <span className="tab-icon">{icon}</span>{label}
              </button>
            ))}
          </div>

          {tab==="send" && (
            <div className="section-grid fade">
              <div>
                <div className="card">
                  <p className="card-subtitle">{t.sendDesc}</p>
                  <div className="token-row">
                    {["ETH","USDC","USDT"].map(tk=>(
                      <button key={tk} className={`token-btn ${token===tk?"active":""}`} onClick={()=>{setToken(tk);setSelDenom(null);setAmount("");}}>
                        {tk}
                      </button>
                    ))}
                  </div>
                  <div className="options-row">
                    <button className={`option-chip ${useFixed?"active":""}`} onClick={()=>{setUseFixed(f=>!f);setSelDenom(null);setAmount("");}}>
                      📐 {t.fixedDenom}
                      <span style={{fontSize:10,opacity:0.7}}>· {t.fixedDenomDesc}</span>
                      <span className={`chip-check ${useFixed?"on":""}`}>{useFixed?"✓":""}</span>
                    </button>
                    <button className={`option-chip ${useLock?"active":""}`} onClick={()=>setUseLock(l=>!l)}>
                      ⏳ {t.timelock}
                      <span style={{fontSize:10,opacity:0.7}}>· {t.timelockDesc}</span>
                      <span className={`chip-check ${useLock?"on":""}`}>{useLock?"✓":""}</span>
                    </button>
                  </div>
                  {useFixed ? (
                    <div className="denom-wrap">
                      <div className="denom-label">{t.amount}</div>
                      <div className="denom-grid">
                        {DENOMS[token].map(d=>(
                          <button key={d} className={`denom-btn ${selDenom===d?"active":""}`} onClick={()=>setSelDenom(d)}>{d} {token}</button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="amount-wrap">
                      <input className="amount-input" type="number" placeholder="0.00" value={amount} onChange={e=>setAmount(e.target.value)} step="any" min="0"/>
                      <span className="amount-token">{token}</span>
                    </div>
                  )}
                  <div style={{marginBottom:16}}>
                    <label className="field-label">{t.to}</label>
                    <input className="field-input" placeholder="st:0x... ou 0x..." value={recipient} onChange={e=>setRecipient(e.target.value)}/>
                    <div className="field-hint">{t.toHint}</div>
                  </div>
                  {(amount||selDenom) && (
                    <div className="fee-row">
                      <span className="fee-label">{t.fee}</span>
                      <span className="fee-value" style={{color:tier.color}}>{tier.bps/100}% · {tier.label}</span>
                    </div>
                  )}
                  <button className="btn-primary" onClick={send} disabled={loading}>
                    {loading ? <><span className="spin"/>{t.sending}</> : "→ " + t.sendBtn}
                  </button>
                </div>
                {pipeData && (
                  <div className="pipeline fade">
                    <div className="pipeline-title">{t.pipeline}</div>
                    <div className="pipeline-steps">
                      {pipeSteps.map((label,i)=>{
                        const s = pipeStatus(i);
                        return (
                          <div key={i} className="pipe-step">
                            <div className={`pipe-dot ${s}`}>{s==="done"?"✓":s==="active"?"◉":"○"}</div>
                            <span className={`pipe-label ${s==="active"?"active":""}`}>{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <div className="card" style={{marginBottom:16}}>
                  <div className="card-title">{t.history}</div>
                  {history.length===0 ? (
                    <div className="history-empty">
                      <div className="history-empty-icon">↗</div>
                      <div style={{fontWeight:600,marginBottom:4}}>{t.noHistory}</div>
                      <div style={{fontSize:12}}>{t.noHistoryDesc}</div>
                    </div>
                  ) : (
                    <div className="history-list">
                      {history.map((h,i)=>(
                        <div key={i} className="history-row">
                          <div className="history-ico">{h.token?.slice(0,1)}</div>
                          <div className="history-body">
                            <div className="history-amount">{h.amount} {h.token}</div>
                            <div className="history-dest">{h.to?.slice(0,28)}...</div>
                            <a className="history-link" href={`https://basescan.org/tx/${h.hash}`} target="_blank" rel="noreferrer">{t.basescan} ↗</a>
                          </div>
                          <span className={`history-badge ${h.status==="done"?"badge-done":"badge-pending"}`}>{h.status==="done"?"✓":"..."}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="how-card">
                  <div className="how-title">Como funciona</div>
                  <div className="how-steps">
                    {[["Endereço descartável","Um endereço novo é criado para cada envio."],["Roteamento multi-hop","Fundos passam por carteiras intermediárias com delays."],["Valores padronizados","Seu valor se mistura com outros iguais."],["Stealth address","O destinatário é invisível na blockchain."]].map(([title,desc],i)=>(
                      <div key={i} className="how-step">
                        <div className="how-num">{i+1}</div>
                        <div><div className="how-step-title">{title}</div><div className="how-step-desc">{desc}</div></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab==="receive" && (
            <div className="section-grid fade">
              <div>
                {!sk ? (
                  <div className="card">
                    <div className="empty-state">
                      <div className="empty-icon">⬇</div>
                      <div className="empty-title">{t.noKeys}</div>
                      <div className="empty-desc">{t.noKeysDesc}</div>
                      <button className="btn-primary" onClick={generateKeys} style={{maxWidth:280,margin:"0 auto"}}>{t.generateBtn}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="receive-address-card">
                      <div className="receive-label">{t.receiveAddress}</div>
                      <div className="receive-addr-display">{meta}</div>
                      <button className={`copy-btn ${copied==="meta"?"copied":""}`} onClick={()=>copyText(meta,"meta")}>
                        {copied==="meta"?t.copied:t.copy}
                      </button>
                    </div>
                    <div className="card" style={{marginBottom:12}}>
                      <div className="card-title">{t.keysHint}</div>
                      <div className="key-row">
                        <span className="key-row-label">🔑 {t.spendKey}</span>
                        <span className="key-row-value">{sk}</span>
                      </div>
                      <div className="key-row" style={{marginBottom:0}}>
                        <span className="key-row-label">👁 {t.viewKey}</span>
                        <span className="key-row-value">{vk}</span>
                      </div>
                      <div className="action-row">
                        <button className="action-btn" onClick={()=>setShowExport(true)}>{t.exportKeys}</button>
                        <button className="action-btn" onClick={generateKeys}>{t.generateKeys}</button>
                      </div>
                    </div>
                    <div className="paylink-section">
                      <div className="paylink-label">🔗 {t.paylink}</div>
                      <div className="paylink-url">{payLink}</div>
                      <p style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>{t.paylinkDesc}</p>
                      <button className={`copy-btn ${copied==="link"?"copied":""}`} onClick={()=>copyText(payLink,"link")} style={{width:"100%",padding:"10px",borderRadius:"var(--r2)",fontSize:13,fontWeight:600}}>
                        {copied==="link"?t.copied:t.copyLink}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="card">
                <div className="card-title">{t.importKeys}</div>
                <p className="card-subtitle">{t.backupDesc}</p>
                <div className="modal-field">
                  <label className="modal-label">{lang==="pt"?"Conteúdo do backup":"Backup content"}</label>
                  <textarea className="modal-input" rows={5} style={{resize:"vertical"}} placeholder={lang==="pt"?"Cole o conteúdo do arquivo .enc aqui":"Paste .enc file content here"} value={importData} onChange={e=>setImportData(e.target.value)}/>
                </div>
                <div className="modal-field">
                  <label className="modal-label">{t.password}</label>
                  <input className="modal-input" type="password" placeholder="••••••••" value={importPwd} onChange={e=>setImportPwd(e.target.value)}/>
                </div>
                <button className="btn-primary" style={{marginTop:8}} onClick={handleImport}>{t.importKeys}</button>
              </div>
            </div>
          )}

          {tab==="scan" && (
            <div className="section-grid fade">
              <div>
                <div className="card">
                  <div className="scan-hero">
                    <div className="scan-hero-icon">⬡</div>
                    <div className="scan-hero-title">{t.scanTitle}</div>
                    <div className="scan-hero-sub">{t.scanDesc}</div>
                  </div>
                  {!sk && <div className="alert alert-warn">{t.noKeysForScan}</div>}
                  <button className="btn-primary" onClick={scan} disabled={scanning||!sk}>
                    {scanning?<><span className="spin" style={{borderTopColor:"#08090d"}}/>{t.scanning}</>:t.scanBtn}
                  </button>
                  {scanResults.length>0 && (
                    <div className="scan-result-card">
                      <div className="scan-result-header">✓ {scanResults.length} {t.scanFound}</div>
                      {scanResults.map((r,i)=>(
                        <div key={i} className="scan-item">
                          <div className="scan-item-amount">{r.amount} {r.token}</div>
                          <div className="scan-item-addr">{fmt(r.stealthAddress)}</div>
                          {r.timelocked&&r.unlockAt>Date.now()/1000
                            ?<div className="scan-item-locked">🔒 {t.locked}: {new Date(r.unlockAt*1000).toLocaleString()}</div>
                            :<div style={{fontSize:11,color:"var(--green)",marginTop:4}}>✓ {t.unlocked}</div>
                          }
                          <a className="scan-item-link" href={`https://basescan.org/tx/${r.txHash}`} target="_blank" rel="noreferrer">Basescan ↗</a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="how-card">
                <div className="how-title">{t.howScan}</div>
                <div className="how-steps">
                  {[[t.how1t,t.how1d],[t.how2t,t.how2d],[t.how3t,t.how3d]].map(([title,desc],i)=>(
                    <div key={i} className="how-step">
                      <div className="how-num">{i+1}</div>
                      <div><div className="how-step-title">{title}</div><div className="how-step-desc">{desc}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab==="withdraw" && (
            <div className="section-grid fade">
              <div>
                <div className="card" style={{marginBottom:16}}>
                  <div className="card-title">{t.withdrawTitle}</div>
                  <p className="card-subtitle">{t.withdrawDesc}</p>
                  {!account && <div className="alert alert-info" style={{marginBottom:14}}>{lang==="pt"?"Conecte sua carteira para sacar.":"Connect your wallet to withdraw."}</div>}
                  {scanResults.length===0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">💳</div>
                      <div className="empty-title">{t.noWithdraw}</div>
                      <div className="empty-desc">{t.noWithdrawDesc}</div>
                      <button className="btn-secondary" onClick={()=>setTab("scan")} style={{maxWidth:240,margin:"0 auto"}}>→ {t.goScan}</button>
                    </div>
                  ) : scanResults.map((r,i)=>{
                    const isLocked = r.timelocked&&r.unlockAt>Date.now()/1000;
                    return (
                      <div key={i} className="withdraw-item">
                        <div className="withdraw-amount">{r.amount} {r.token}</div>
                        <div className="withdraw-addr">{r.stealthAddress}</div>
                        <div className={`withdraw-status ${isLocked?"status-locked":"status-unlocked"}`}>
                          {isLocked?`🔒 ${t.locked}: ${new Date(r.unlockAt*1000).toLocaleString()}`:`✓ ${t.unlocked}`}
                        </div>
                        <button className="btn-primary" onClick={()=>doWithdraw(r)} disabled={loading||isLocked||!account}>
                          {loading ? <><span className="spin" style={{borderTopColor:"#08090d"}}/>{t.withdrawing}</> : "→ " + t.withdrawBtn}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="card">
                  <div className="card-title">{t.gasless}</div>
                  <p style={{fontSize:13,color:"var(--text2)",lineHeight:1.7,marginBottom:20}}>{t.gaslessDesc}</p>
                  <div style={{padding:"14px 16px",background:"var(--surface2)",borderRadius:"var(--r2)",border:"1px solid var(--border)"}}>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>{t.contractVerified}</div>
                    <a href={`https://basescan.org/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer" style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--accent2)",wordBreak:"break-all"}}>
                      {CONTRACT_ADDRESS}
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {showExport && (
          <div className="modal-bg" onClick={()=>setShowExport(false)}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="modal-title">{t.exportTitle}</div>
              <div className="modal-field">
                <label className="modal-label">{t.password}</label>
                <input className="modal-input" type="password" placeholder="••••••••" value={exportPwd} onChange={e=>setExportPwd(e.target.value)}/>
              </div>
              <div className="modal-actions">
                <button className="modal-cancel" onClick={()=>{setShowExport(false);setExportPwd("");}}>{t.cancel}</button>
                <button className="modal-confirm" onClick={handleExport}>{t.confirm}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
