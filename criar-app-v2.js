const fs = require("fs");
const path = require("path");

// Lê a logo
const logoPath = path.join(__dirname, "frontend", "public", "logo.png");

// Copia a logo para o public do React
const logoSrc = "C:\\Users\\EmilioMarello\\OneDrive\\Desktop\\silentflow\\frontend\\public\\logo.png";

const codigo = `import { useState, useEffect } from "react";
import { ethers } from "ethers";

const CONTRATO_ENDERECO = "0xB8ACFF6EC0D9E4E31D029bC049EfadeFBd9d0650";
const CONTRATO_ABI = ["function enviar(address payable destinatario) external payable"];
const FEE = 0.002;

const css = \\\`
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Mono:wght@300;400&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{background:#010408;font-family:'DM Mono',monospace}
.bg-glow{position:fixed;top:-200px;left:50%;transform:translateX(-50%);width:800px;height:800px;background:radial-gradient(ellipse,rgba(30,144,255,0.08) 0%,transparent 70%);pointer-events:none;z-index:0}
.bg-grid{position:fixed;inset:0;background-image:linear-gradient(rgba(30,144,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(30,144,255,0.03) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0}
.wrap{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
.nav{position:fixed;top:0;left:0;right:0;padding:18px 32px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(30,144,255,0.08);background:rgba(1,4,8,0.85);backdrop-filter:blur(12px);z-index:10}
.nav img{width:26px;height:26px;object-fit:contain}
.nav-name{font-family:'Syne',sans-serif;font-weight:800;font-size:14px;letter-spacing:0.2em;background:linear-gradient(135deg,#1E90FF,#00BFFF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.nav-badge{margin-left:auto;font-size:10px;color:rgba(30,144,255,0.4);border:1px solid rgba(30,144,255,0.15);padding:3px 10px;border-radius:20px;letter-spacing:0.1em}
.card{width:100%;max-width:460px;background:rgba(8,16,28,0.92);border:1px solid rgba(30,144,255,0.12);border-radius:20px;padding:40px;backdrop-filter:blur(20px);box-shadow:0 0 80px rgba(30,144,255,0.06),inset 0 1px 0 rgba(30,144,255,0.08);animation:fadeUp 0.5s ease forwards}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.hdr{text-align:center;margin-bottom:32px}
.logo-row{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:6px}
.logo-row img{width:34px;height:34px;object-fit:contain;filter:drop-shadow(0 0 10px rgba(30,144,255,0.7))}
.logo-title{font-family:'Syne',sans-serif;font-weight:800;font-size:24px;letter-spacing:0.22em;background:linear-gradient(135deg,#1E90FF,#00BFFF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.sub{font-size:10px;color:rgba(30,144,255,0.35);letter-spacing:0.18em;text-transform:uppercase}
.div{width:50px;height:1px;background:linear-gradient(90deg,transparent,rgba(30,144,255,0.25),transparent);margin:14px auto 0}
.fld{margin-bottom:14px}
.fld label{display:block;font-size:10px;color:rgba(30,144,255,0.45);letter-spacing:0.2em;margin-bottom:7px;text-transform:uppercase}
.fld input{width:100%;background:rgba(30,144,255,0.04);border:1px solid rgba(30,144,255,0.1);border-radius:10px;padding:13px 15px;color:#d8eeff;font-size:13px;font-family:'DM Mono',monospace;outline:none;transition:all 0.2s}
.fld input:focus{border-color:rgba(30,144,255,0.35);background:rgba(30,144,255,0.07);box-shadow:0 0 0 3px rgba(30,144,255,0.07)}
.fld input::placeholder{color:rgba(80,120,180,0.3)}
.fee-box{background:rgba(30,144,255,0.03);border:1px solid rgba(30,144,255,0.08);border-radius:10px;padding:13px 15px;margin-bottom:18px;animation:fadeIn 0.25s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.fee-row{display:flex;justify-content:space-between;font-size:11px;padding:2px 0}
.fee-row .lbl{color:rgba(100,150,200,0.45)}
.fee-row .val{color:rgba(30,144,255,0.55)}
.fee-sep{height:1px;background:rgba(30,144,255,0.07);margin:7px 0}
.fee-row.tot .lbl{color:rgba(200,230,255,0.65)}
.fee-row.tot .val{color:#1E90FF;font-weight:500}
.btn{width:100%;padding:15px;background:linear-gradient(135deg,#1E90FF,#005FCC);border:none;border-radius:11px;color:#fff;font-family:'Syne',sans-serif;font-weight:800;font-size:13px;letter-spacing:0.18em;cursor:pointer;transition:all 0.25s;text-transform:uppercase;position:relative;overflow:hidden}
.btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 10px 35px rgba(30,144,255,0.3)}
.btn:disabled{background:rgba(30,144,255,0.12);color:rgba(30,144,255,0.35);cursor:not-allowed}
.shine{position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent);animation:shine 2.5s infinite}
@keyframes shine{to{left:100%}}
.status{margin-top:14px;padding:13px 15px;background:rgba(30,144,255,0.04);border:1px solid rgba(30,144,255,0.09);border-radius:10px;font-size:11px;color:rgba(140,190,255,0.6);text-align:center;letter-spacing:0.06em;animation:fadeIn 0.3s ease}
.status.ok{border-color:rgba(30,144,255,0.25);color:#1E90FF;background:rgba(30,144,255,0.07)}
.tx{display:block;margin-top:10px;text-align:center;font-size:11px;color:rgba(30,144,255,0.45);text-decoration:none;letter-spacing:0.08em;transition:color 0.2s}
.tx:hover{color:#1E90FF}
.dot{display:inline-block;width:5px;height:5px;background:#1E90FF;border-radius:50%;margin-right:7px;animation:pulse 1.4s infinite;vertical-align:middle}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.3;transform:scale(0.7)}}
\\\`;

export default function App() {
  const [dest, setDest] = useState("");
  const [valor, setValor] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
    document.body.style.background = "#010408";
    return () => document.head.removeChild(el);
  }, []);

  async function enviar() {
    try {
      setLoading(true); setOk(false); setTxHash(null);
      setStatus("Conectando carteira...");
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const net = await provider.getNetwork();
      if (net.chainId !== 11155111n) {
        setStatus("Trocando para Sepolia...");
        try { await provider.send("wallet_switchEthereumChain",[{chainId:"0xaa36a7"}]); }
        catch(e) { setStatus("Troque para Sepolia na MetaMask."); setLoading(false); return; }
      }
      const signer = await provider.getSigner();
      const contrato = new ethers.Contract(CONTRATO_ENDERECO, CONTRATO_ABI, signer);
      setStatus("Aguardando confirmacao...");
      const tx = await contrato.enviar(dest, { value: ethers.parseEther(valor), gasLimit: 60000 });
      setStatus("Confirmando...");
      await tx.wait();
      setTxHash(tx.hash); setOk(true);
      setStatus("Enviado com privacidade.");
    } catch(err) {
      setStatus("Erro: " + err.message.slice(0,80));
    } finally { setLoading(false); }
  }

  const fee = valor && !isNaN(parseFloat(valor)) ? (parseFloat(valor)*FEE).toFixed(6) : null;
  const fin = valor && !isNaN(parseFloat(valor)) ? (parseFloat(valor)*(1-FEE)).toFixed(6) : null;

  return (
    <div className="wrap">
      <div className="bg-glow"/>
      <div className="bg-grid"/>
      <nav className="nav">
        <img src="/logo.png" alt="logo"/>
        <span className="nav-name">SILENTFLOW</span>
        <span className="nav-badge">TESTNET</span>
      </nav>
      <div className="card">
        <div className="hdr">
          <div className="logo-row">
            <img src="/logo.png" alt="logo"/>
            <span className="logo-title">SILENTFLOW</span>
          </div>
          <p className="sub">Privacy Layer for Web3</p>
          <div className="div"/>
        </div>
        <div className="fld">
          <label>Destinatario</label>
          <input value={dest} onChange={e=>setDest(e.target.value)} placeholder="0x..."/>
        </div>
        <div className="fld">
          <label>Valor (ETH)</label>
          <input value={valor} onChange={e=>setValor(e.target.value)} placeholder="0.01" type="number"/>
        </div>
        {fee && (
          <div className="fee-box">
            <div className="fee-row"><span className="lbl">Fee SilentFlow (0.2%)</span><span className="val">{fee} ETH</span></div>
            <div className="fee-sep"/>
            <div className="fee-row tot"><span className="lbl">Destinatario recebe</span><span className="val">{fin} ETH</span></div>
          </div>
        )}
        <button className="btn" onClick={enviar} disabled={loading||!dest||!valor}>
          {!loading && <span className="shine"/>}
          {loading ? <span><span className="dot"/>Processando...</span> : "Enviar com privacidade"}
        </button>
        {status && <div className={"status"+(ok?" ok":"")}>{status}</div>}
        {txHash && <a className="tx" href={"https://sepolia.etherscan.io/tx/"+txHash} target="_blank" rel="noreferrer">Ver transacao no Etherscan →</a>}
      </div>
    </div>
  );
}`;

fs.writeFileSync("./frontend/src/App.js", codigo, "utf8");
console.log("App.js criado com sucesso!");