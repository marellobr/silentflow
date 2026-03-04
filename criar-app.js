const fs = require("fs");

const codigo = `import { useState } from "react";
import { ethers } from "ethers";

const CONTRATO_ENDERECO = "0xB8ACFF6EC0D9E4E31D029bC049EfadeFBd9d0650";
const CONTRATO_ABI = ["function enviar(address payable destinatario) external payable"];
const FEE = 0.002;

export default function App() {
  const [dest, setDest] = useState("");
  const [valor, setValor] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState(null);

  async function enviar() {
    try {
      setLoading(true);
      setTxHash(null);
      setStatus("Conectando carteira...");
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);

// Verifica se está na Sepolia (chainId 11155111)
const network = await provider.getNetwork();
if (network.chainId !== 11155111n) {
  setStatus("Trocando para Sepolia...");
  try {
    await provider.send("wallet_switchEthereumChain", [{ chainId: "0xaa36a7" }]);
  } catch (e) {
    setStatus("Erro ao trocar rede. Troque manualmente para Sepolia na MetaMask.");
    setLoading(false);
    return;
  }
}

const signer = await provider.getSigner();
      const contrato = new ethers.Contract(CONTRATO_ENDERECO, CONTRATO_ABI, signer);
      setStatus("Confirme na MetaMask...");
      const tx = await contrato.enviar(dest, { value: ethers.parseEther(valor), gasLimit: 60000 });
      setStatus("Aguardando confirmacao...");
      await tx.wait();
      setTxHash(tx.hash);
      setStatus("Enviado com privacidade!");
    } catch (err) {
      setStatus("Erro: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{minHeight:"100vh",backgroundColor:"#0a0a0a",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"monospace"}}>
      <div style={{backgroundColor:"#111",border:"1px solid #222",borderRadius:"16px",padding:"40px",width:"100%",maxWidth:"500px"}}>
        <div style={{textAlign:"center",marginBottom:"32px"}}>
          <h1 style={{color:"#fff",fontSize:"28px",margin:0}}>SilentFlow</h1>
          <p style={{color:"#555",fontSize:"13px",marginTop:"8px"}}>Privacy layer for Web3 transactions</p>
        </div>
        <div style={{marginBottom:"16px"}}>
          <label style={{color:"#888",fontSize:"12px"}}>DESTINATARIO</label>
          <input value={dest} onChange={e=>setDest(e.target.value)} placeholder="0x..." style={{width:"100%",backgroundColor:"#1a1a1a",border:"1px solid #333",borderRadius:"8px",padding:"12px",color:"#fff",fontSize:"14px",marginTop:"6px",boxSizing:"border-box"}} />
        </div>
        <div style={{marginBottom:"24px"}}>
          <label style={{color:"#888",fontSize:"12px"}}>VALOR (ETH)</label>
          <input value={valor} onChange={e=>setValor(e.target.value)} placeholder="0.01" type="number" style={{width:"100%",backgroundColor:"#1a1a1a",border:"1px solid #333",borderRadius:"8px",padding:"12px",color:"#fff",fontSize:"14px",marginTop:"6px",boxSizing:"border-box"}} />
        </div>
        {valor && !isNaN(parseFloat(valor)) && (
          <div style={{backgroundColor:"#1a1a1a",border:"1px solid #222",borderRadius:"8px",padding:"12px",marginBottom:"24px",fontSize:"13px"}}>
            <div style={{display:"flex",justifyContent:"space-between",color:"#666"}}>
              <span>Fee SilentFlow (0.2%)</span>
              <span>{(parseFloat(valor)*FEE).toFixed(6)} ETH</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",color:"#aaa",marginTop:"6px"}}>
              <span>Destinatario recebe</span>
              <span>{(parseFloat(valor)*(1-FEE)).toFixed(6)} ETH</span>
            </div>
          </div>
        )}
        <button onClick={enviar} disabled={loading||!dest||!valor} style={{width:"100%",backgroundColor:loading?"#333":"#6366f1",color:"#fff",border:"none",borderRadius:"8px",padding:"14px",fontSize:"15px",cursor:loading?"not-allowed":"pointer",fontFamily:"monospace"}}>
          {loading ? "Processando..." : "Enviar com privacidade"}
        </button>
        {status && (
          <div style={{marginTop:"20px",padding:"12px",backgroundColor:"#1a1a1a",borderRadius:"8px",color:"#aaa",fontSize:"13px",textAlign:"center"}}>
            {status}
          </div>
        )}
        {txHash && (
          <div style={{marginTop:"12px",textAlign:"center",fontSize:"12px"}}>
            <span style={{color:"#555"}}>TX: </span>
            <span style={{color:"#6366f1"}}>{txHash.slice(0,20)}...</span>
          </div>
        )}
      </div>
    </div>
  );
}`;

fs.writeFileSync("./frontend/src/App.js", codigo, "utf8");
console.log("App.js criado com sucesso!");