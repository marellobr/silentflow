import { useState, useEffect } from "react";
import { ethers } from "ethers";

const CONTRATO_ENDERECO = "0x3b1958ee8e636d69E868CaFCad3e7dB2eE8B4755";
const CONTRATO_ABI = [
  "function enviar(address payable destinatario) external payable",
  "function enviarToken(address token, address destinatario, uint256 valor) external"
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)"
];
const TOKENS = {
  ETH:  { symbol:"ETH",  address:null, decimals:18, icon:"⟠" },
  USDC: { symbol:"USDC", address:"0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals:6, icon:"◎" },
  USDT: { symbol:"USDT", address:"0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0", decimals:6, icon:"₮" },
};

function loadHistory() {
  try { return JSON.parse(localStorage.getItem("sf_history") || "[]"); }
  catch { return []; }
}
function saveHistory(h) {
  localStorage.setItem("sf_history", JSON.stringify(h.slice(0, 50)));
}

export default function App() {
  const [dest, setDest] = useState("");
  const [valor, setValor] = useState("");
  const [token, setToken] = useState("ETH");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState("send");
  const [history, setHistory] = useState(loadHistory());

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Mono:wght@300;400&display=swap";
    document.head.appendChild(link);
    document.body.style.cssText = "margin:0;background:#010408;font-family:'DM Mono',monospace";
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
        try { await provider.send("wallet_switchEthereumChain", [{ chainId: "0xaa36a7" }]); }
        catch(e) { setStatus("Troque para Sepolia na MetaMask."); setLoading(false); return; }
      }
      const signer = await provider.getSigner();
      const contrato = new ethers.Contract(CONTRATO_ENDERECO, CONTRATO_ABI, signer);
      let tx;

      if (token === "ETH") {
        setStatus("Aguardando confirmacao...");
        tx = await contrato.enviar(dest, { value: ethers.parseEther(valor), gasLimit: 60000 });
      } else {
        const tokenInfo = TOKENS[token];
        const tokenContract = new ethers.Contract(tokenInfo.address, ERC20_ABI, signer);
        const valorParsed = ethers.parseUnits(valor, tokenInfo.decimals);
        setStatus("Aprovando " + token + "...");
        const approveTx = await tokenContract.approve(CONTRATO_ENDERECO, valorParsed);
        await approveTx.wait();
        setStatus("Enviando " + token + "...");
        tx = await contrato.enviarToken(tokenInfo.address, dest, valorParsed, { gasLimit: 120000 });
      }

      setStatus("Confirmando...");
      await tx.wait();
      setTxHash(tx.hash); setOk(true);
      setStatus(token + " enviado com privacidade.");

      const newEntry = {
        hash: tx.hash,
        token,
        valor,
        dest: dest.slice(0,6) + "..." + dest.slice(-4),
        destFull: dest,
        fee: (parseFloat(valor) * 0.002).toFixed(token === "ETH" ? 6 : 2),
        recebe: (parseFloat(valor) * 0.998).toFixed(token === "ETH" ? 6 : 2),
        date: new Date().toLocaleString("pt-BR"),
        status: "Confirmado"
      };
      const newHistory = [newEntry, ...history];
      setHistory(newHistory);
      saveHistory(newHistory);

    } catch(err) {
      setStatus("Erro: " + err.message.slice(0, 80));
    } finally { setLoading(false); }
  }

  const fee = valor && !isNaN(parseFloat(valor)) ? (parseFloat(valor)*0.002).toFixed(token==="ETH"?6:2) : null;
  const fin = valor && !isNaN(parseFloat(valor)) ? (parseFloat(valor)*0.998).toFixed(token==="ETH"?6:2) : null;

  const S = {
    wrap: { position:"relative", minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"24px 16px", background:"#010408" },
    bgGlow: { position:"fixed", top:"-200px", left:"50%", transform:"translateX(-50%)", width:"800px", height:"800px", background:"radial-gradient(ellipse,rgba(30,144,255,0.07) 0%,transparent 70%)", pointerEvents:"none", zIndex:0 },
    bgGrid: { position:"fixed", inset:0, backgroundImage:"linear-gradient(rgba(30,144,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(30,144,255,0.03) 1px,transparent 1px)", backgroundSize:"40px 40px", pointerEvents:"none", zIndex:0 },
    nav: { position:"fixed", top:0, left:0, right:0, padding:"16px 32px", display:"flex", alignItems:"center", gap:"10px", borderBottom:"1px solid rgba(30,144,255,0.08)", background:"rgba(1,4,8,0.88)", backdropFilter:"blur(12px)", zIndex:10 },
    navImg: { width:"26px", height:"26px", objectFit:"contain" },
    navName: { fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:"14px", letterSpacing:"0.2em", background:"linear-gradient(135deg,#1E90FF,#00BFFF)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" },
    navBadge: { marginLeft:"auto", fontSize:"10px", color:"rgba(30,144,255,0.4)", border:"1px solid rgba(30,144,255,0.15)", padding:"3px 10px", borderRadius:"20px", letterSpacing:"0.1em" },
    card: { position:"relative", zIndex:1, width:"100%", maxWidth:"480px", background:"rgba(8,16,28,0.94)", border:"1px solid rgba(30,144,255,0.12)", borderRadius:"20px", padding:"36px", backdropFilter:"blur(20px)", boxShadow:"0 0 80px rgba(30,144,255,0.06),inset 0 1px 0 rgba(30,144,255,0.08)" },
    hdr: { textAlign:"center", marginBottom:"28px" },
    logoRow: { display:"flex", alignItems:"center", justifyContent:"center", gap:"12px", marginBottom:"8px" },
    logoImg: { width:"36px", height:"36px", objectFit:"contain", filter:"drop-shadow(0 0 12px rgba(30,144,255,0.7))" },
    logoTitle: { fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:"22px", letterSpacing:"0.22em", background:"linear-gradient(135deg,#1E90FF,#00BFFF)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" },
    sub: { fontSize:"10px", color:"rgba(30,144,255,0.35)", letterSpacing:"0.18em" },
    divider: { width:"50px", height:"1px", background:"linear-gradient(90deg,transparent,rgba(30,144,255,0.25),transparent)", margin:"12px auto 0" },
    tabs: { display:"flex", gap:"8px", marginBottom:"24px" },
    tab: (active) => ({ flex:1, padding:"10px", border: active ? "1px solid rgba(30,144,255,0.4)" : "1px solid rgba(30,144,255,0.08)", borderRadius:"10px", background: active ? "rgba(30,144,255,0.1)" : "transparent", color: active ? "#1E90FF" : "rgba(100,150,200,0.4)", fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:"11px", letterSpacing:"0.15em", cursor:"pointer", textTransform:"uppercase" }),
    fieldWrap: { marginBottom:"14px" },
    label: { display:"block", fontSize:"10px", color:"rgba(30,144,255,0.45)", letterSpacing:"0.2em", marginBottom:"7px", textTransform:"uppercase" },
    input: { width:"100%", background:"rgba(30,144,255,0.04)", border:"1px solid rgba(30,144,255,0.1)", borderRadius:"10px", padding:"13px 15px", color:"#d8eeff", fontSize:"13px", fontFamily:"'DM Mono',monospace", outline:"none", boxSizing:"border-box" },
    tokenRow: { display:"flex", gap:"8px", marginBottom:"14px" },
    tokenBtn: (active) => ({ flex:1, padding:"10px", border: active ? "1px solid rgba(30,144,255,0.5)" : "1px solid rgba(30,144,255,0.1)", borderRadius:"10px", background: active ? "rgba(30,144,255,0.12)" : "rgba(30,144,255,0.03)", color: active ? "#1E90FF" : "rgba(100,150,200,0.5)", fontFamily:"'DM Mono',monospace", fontSize:"12px", cursor:"pointer", letterSpacing:"0.1em", transition:"all 0.2s" }),
    feeBox: { background:"rgba(30,144,255,0.03)", border:"1px solid rgba(30,144,255,0.08)", borderRadius:"10px", padding:"13px 15px", marginBottom:"18px" },
    feeRow: { display:"flex", justifyContent:"space-between", fontSize:"11px", padding:"2px 0" },
    feeSep: { height:"1px", background:"rgba(30,144,255,0.07)", margin:"7px 0" },
    btn: { width:"100%", padding:"15px", background:"linear-gradient(135deg,#1E90FF,#005FCC)", border:"none", borderRadius:"11px", color:"#fff", fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:"13px", letterSpacing:"0.18em", cursor:"pointer", textTransform:"uppercase" },
    btnOff: { width:"100%", padding:"15px", background:"rgba(30,144,255,0.12)", border:"none", borderRadius:"11px", color:"rgba(30,144,255,0.35)", fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:"13px", letterSpacing:"0.18em", cursor:"not-allowed", textTransform:"uppercase" },
    statusBox: { marginTop:"14px", padding:"13px 15px", background:"rgba(30,144,255,0.04)", border:"1px solid rgba(30,144,255,0.09)", borderRadius:"10px", fontSize:"11px", color:"rgba(140,190,255,0.6)", textAlign:"center", letterSpacing:"0.06em" },
    statusOk: { marginTop:"14px", padding:"13px 15px", background:"rgba(30,144,255,0.07)", border:"1px solid rgba(30,144,255,0.25)", borderRadius:"10px", fontSize:"11px", color:"#1E90FF", textAlign:"center", letterSpacing:"0.06em" },
    txLink: { display:"block", marginTop:"10px", textAlign:"center", fontSize:"11px", color:"rgba(30,144,255,0.45)", textDecoration:"none", letterSpacing:"0.08em" },
    emptyHistory: { textAlign:"center", padding:"40px 0", color:"rgba(30,144,255,0.2)", fontSize:"12px", letterSpacing:"0.1em" },
    historyItem: { background:"rgba(30,144,255,0.03)", border:"1px solid rgba(30,144,255,0.08)", borderRadius:"12px", padding:"14px 16px", marginBottom:"10px" },
    histRow: { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" },
    histToken: { fontSize:"13px", color:"#1E90FF", fontFamily:"'Syne',sans-serif", fontWeight:700 },
    histValor: { fontSize:"13px", color:"#d8eeff" },
    histDest: { fontSize:"11px", color:"rgba(100,150,200,0.5)" },
    histDate: { fontSize:"10px", color:"rgba(100,150,200,0.3)" },
    histBadge: { fontSize:"10px", color:"rgba(30,255,100,0.6)", border:"1px solid rgba(30,255,100,0.2)", padding:"2px 8px", borderRadius:"10px" },
    histLink: { fontSize:"10px", color:"rgba(30,144,255,0.4)", textDecoration:"none", letterSpacing:"0.05em" },
    clearBtn: { width:"100%", padding:"10px", background:"transparent", border:"1px solid rgba(255,50,50,0.15)", borderRadius:"10px", color:"rgba(255,100,100,0.4)", fontFamily:"'DM Mono',monospace", fontSize:"11px", cursor:"pointer", marginTop:"8px", letterSpacing:"0.1em" },
  };

  return (
    <div style={S.wrap}>
      <div style={S.bgGlow}/>
      <div style={S.bgGrid}/>
      <nav style={S.nav}>
        <img src="/logo.png" alt="logo" style={S.navImg}/>
        <span style={S.navName}>SILENTFLOW</span>
        <span style={S.navBadge}>TESTNET</span>
      </nav>
      <div style={S.card}>
        <div style={S.hdr}>
          <div style={S.logoRow}>
            <img src="/logo.png" alt="logo" style={S.logoImg}/>
            <span style={S.logoTitle}>SILENTFLOW</span>
          </div>
          <p style={S.sub}>PRIVACY LAYER FOR WEB3</p>
          <div style={S.divider}/>
        </div>

        <div style={S.tabs}>
          <button style={S.tab(tab==="send")} onClick={()=>setTab("send")}>Enviar</button>
          <button style={S.tab(tab==="history")} onClick={()=>setTab("history")}>
            Historico {history.length > 0 && `(${history.length})`}
          </button>
        </div>

        {tab === "send" && (
          <div>
            <div style={S.fieldWrap}>
              <label style={S.label}>Token</label>
              <div style={S.tokenRow}>
                {Object.keys(TOKENS).map(t => (
                  <button key={t} style={S.tokenBtn(token===t)} onClick={()=>setToken(t)}>
                    {TOKENS[t].icon} {t}
                  </button>
                ))}
              </div>
            </div>
            <div style={S.fieldWrap}>
              <label style={S.label}>Destinatario</label>
              <input style={S.input} value={dest} onChange={e=>setDest(e.target.value)} placeholder="0x..."/>
            </div>
            <div style={S.fieldWrap}>
              <label style={S.label}>Valor ({token})</label>
              <input style={S.input} value={valor} onChange={e=>setValor(e.target.value)} placeholder={token==="ETH"?"0.01":"10.00"} type="number"/>
            </div>
            {fee && (
              <div style={S.feeBox}>
                <div style={S.feeRow}>
                  <span style={{color:"rgba(100,150,200,0.45)"}}>Fee SilentFlow (0.2%)</span>
                  <span style={{color:"rgba(30,144,255,0.55)"}}>{fee} {token}</span>
                </div>
                <div style={S.feeSep}/>
                <div style={S.feeRow}>
                  <span style={{color:"rgba(200,230,255,0.65)"}}>Destinatario recebe</span>
                  <span style={{color:"#1E90FF"}}>{fin} {token}</span>
                </div>
              </div>
            )}
            <button style={loading||!dest||!valor ? S.btnOff : S.btn} onClick={enviar} disabled={loading||!dest||!valor}>
              {loading ? "Processando..." : "Enviar com privacidade"}
            </button>
            {status && <div style={ok?S.statusOk:S.statusBox}>{status}</div>}
            {txHash && (
              <a style={S.txLink} href={"https://sepolia.etherscan.io/tx/"+txHash} target="_blank" rel="noreferrer">
                Ver transacao no Etherscan
              </a>
            )}
          </div>
        )}

        {tab === "history" && (
          <div>
            {history.length === 0 ? (
              <div style={S.emptyHistory}>Nenhuma transacao ainda</div>
            ) : (
              history.map((tx, i) => (
                <div key={i} style={S.historyItem}>
                  <div style={S.histRow}>
                    <span style={S.histToken}>{TOKENS[tx.token]?.icon} {tx.token}</span>
                    <span style={S.histValor}>{tx.recebe} {tx.token}</span>
                  </div>
                  <div style={S.histRow}>
                    <span style={S.histDest}>Para: {tx.dest}</span>
                    <span style={S.histBadge}>{tx.status}</span>
                  </div>
                  <div style={{...S.histRow, marginBottom:0}}>
                    <span style={S.histDate}>{tx.date}</span>
                    <a style={S.histLink} href={"https://sepolia.etherscan.io/tx/"+tx.hash} target="_blank" rel="noreferrer">
                      Ver TX →
                    </a>
                  </div>
                </div>
              ))
            )}
            {history.length > 0 && (
              <button style={S.clearBtn} onClick={()=>{setHistory([]);saveHistory([]);}}>
                Limpar historico
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
