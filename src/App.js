import { useState, useEffect } from "react";
import { ethers } from "ethers";

const CONTRACT_ADDRESS = "0x3b1958ee8e636d69E868CaFCad3e7dB2eE8B4755";
const BACKEND_URL = "https://silentflow-production.up.railway.app";

const ABI = [
  "function depositETH(address recipient) external payable",
  "function depositToken(address token, uint256 amount, address recipient) external",
  "function withdraw(address token, uint256 amount) external",
  "event Deposit(address indexed sender, address indexed recipient, address token, uint256 amount)",
];

const TOKENS = {
  ETH: { address: null, decimals: 18, symbol: "ETH" },
  USDC: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6, symbol: "USDC" },
  USDT: { address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0", decimals: 6, symbol: "USDT" },
};

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
];

export default function App() {
  const [account, setAccount] = useState(null);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [selectedToken, setSelectedToken] = useState("ETH");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [txHistory, setTxHistory] = useState([]);
  const [pendingId, setPendingId] = useState(null);

  useEffect(() => {
    if (pendingId) {
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`${BACKEND_URL}/status/${pendingId}`);
          const data = await res.json();
          if (data.concluido) {
            setStatus("✅ Transação concluída! Todos os hops entregues.");
            clearInterval(interval);
            setPendingId(null);
          } else {
            setStatus(`⏳ Processando... ${data.hopsFeitos}/${data.hopsTotal} hops (${data.minutosRestantes} min restantes)`);
          }
        } catch (e) {
          // silently fail
        }
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [pendingId]);

  const connectWallet = async () => {
    if (!window.ethereum) return alert("MetaMask não encontrada.");
    const provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_requestAccounts", []);
    setAccount(accounts[0]);
  };

  const sendTransaction = async () => {
    if (!account) return alert("Conecte sua carteira primeiro.");
    if (!amount || !recipient) return alert("Preencha todos os campos.");

    setLoading(true);
    setStatus("🔒 Iniciando pipeline de privacidade...");

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

      let txHash;

      if (selectedToken === "ETH") {
        const value = ethers.parseEther(amount);
        const tx = await contract.depositETH(recipient, { value });
        await tx.wait();
        txHash = tx.hash;
      } else {
        const token = TOKENS[selectedToken];
        const tokenContract = new ethers.Contract(token.address, ERC20_ABI, signer);
        const parsedAmount = ethers.parseUnits(amount, token.decimals);

        const allowance = await tokenContract.allowance(account, CONTRACT_ADDRESS);
        if (allowance < parsedAmount) {
          const approveTx = await tokenContract.approve(CONTRACT_ADDRESS, parsedAmount);
          await approveTx.wait();
        }

        const tx = await contract.depositToken(token.address, parsedAmount, recipient);
        await tx.wait();
        txHash = tx.hash;
      }

      // Agendamento no backend
      const res = await fetch(`${BACKEND_URL}/agendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash,
          destinatario: recipient,
          valor: amount,
          token: selectedToken,
        }),
      });

      const data = await res.json();
      setPendingId(data.id);

      const newTx = {
        id: data.id,
        hash: txHash,
        amount,
        token: selectedToken,
        recipient: recipient.slice(0, 6) + "..." + recipient.slice(-4),
        splits: data.splits,
        hops: data.hopsTotal,
        estimativa: data.estimativaMinutos,
        time: new Date().toLocaleTimeString("pt-BR"),
        status: "processando",
      };

      setTxHistory((prev) => [newTx, ...prev]);
      setStatus(
        `👻 Pipeline iniciado!\nValor dividido em ${data.splits} partes.\nCada parte: 2–3 hops efêmeros.\nEstimativa: ~${data.estimativaMinutos} minutos`
      );
      setAmount("");
      setRecipient("");
    } catch (err) {
      console.error(err);
      setStatus("❌ Erro: " + (err.reason || err.message));
    }

    setLoading(false);
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>👻</span>
          <span style={styles.logoText}>SilentFlow</span>
          <span style={styles.badge}>v2 · Sepolia</span>
        </div>
        <button onClick={connectWallet} style={styles.connectBtn}>
          {account ? account.slice(0, 6) + "..." + account.slice(-4) : "Conectar Carteira"}
        </button>
      </div>

      {/* Main Card */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <span style={styles.cardTitle}>Envio Privado</span>
          <div style={styles.privacyBadge}>
            <span style={{ fontSize: 12 }}>🔒</span>
            <span style={{ fontSize: 12, marginLeft: 4 }}>Split + Multi-hop + Dummy Tx</span>
          </div>
        </div>

        {/* Privacy info box */}
        <div style={styles.infoBox}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>✂️ Split automático</span>
            <span style={styles.infoValue}>2–4 partes aleatórias</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>🔀 Multi-hop por parte</span>
            <span style={styles.infoValue}>2–3 endereços efêmeros</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>⏱ Delay estimado</span>
            <span style={styles.infoValue}>1–10 minutos</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>🎭 Dummy transactions</span>
            <span style={styles.infoValue}>ruído entre hops</span>
          </div>
        </div>

        {/* Token selector */}
        <div style={styles.tokenRow}>
          {Object.keys(TOKENS).map((token) => (
            <button
              key={token}
              onClick={() => setSelectedToken(token)}
              style={{
                ...styles.tokenBtn,
                ...(selectedToken === token ? styles.tokenBtnActive : {}),
              }}
            >
              {token}
            </button>
          ))}
        </div>

        {/* Amount */}
        <div style={styles.inputGroup}>
          <label style={styles.label}>Valor</label>
          <input
            type="number"
            placeholder={`0.0 ${selectedToken}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={styles.input}
          />
        </div>

        {/* Recipient */}
        <div style={styles.inputGroup}>
          <label style={styles.label}>Destinatário</label>
          <input
            type="text"
            placeholder="0x..."
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            style={styles.input}
          />
        </div>

        {/* Fee */}
        <div style={styles.feeBox}>
          <span style={styles.feeText}>Taxa de privacidade: <strong>0,2%</strong></span>
          {amount && (
            <span style={styles.feeValue}>
              ≈ {(parseFloat(amount) * 0.002).toFixed(6)} {selectedToken}
            </span>
          )}
        </div>

        {/* Send button */}
        <button
          onClick={sendTransaction}
          disabled={loading || !account}
          style={{ ...styles.sendBtn, opacity: loading || !account ? 0.6 : 1 }}
        >
          {loading ? "⏳ Processando..." : "👻 Enviar com Privacidade"}
        </button>

        {/* Status */}
        {status && (
          <div style={styles.statusBox}>
            <pre style={styles.statusText}>{status}</pre>
          </div>
        )}
      </div>

      {/* History */}
      {txHistory.length > 0 && (
        <div style={styles.historyCard}>
          <div style={styles.historyTitle}>Histórico</div>
          {txHistory.map((tx) => (
            <div key={tx.id} style={styles.historyItem}>
              <div style={styles.historyRow}>
                <span style={styles.historyBadge}>
                  👻 {tx.splits} splits · {tx.hops} hops
                </span>
                <span style={styles.historyTime}>{tx.time}</span>
              </div>
              <div style={styles.historyDetails}>
                {tx.amount} {tx.token} → {tx.recipient}
              </div>
              <a
                href={`https://sepolia.etherscan.io/tx/${tx.hash}`}
                target="_blank"
                rel="noreferrer"
                style={styles.historyLink}
              >
                Ver no Etherscan ↗
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#010408",
    color: "#fff",
    fontFamily: "'DM Mono', monospace",
    padding: "20px",
    maxWidth: "480px",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "32px",
    paddingTop: "8px",
  },
  logo: { display: "flex", alignItems: "center", gap: "8px" },
  logoIcon: { fontSize: "24px" },
  logoText: { fontSize: "20px", fontWeight: "700", color: "#1E90FF" },
  badge: {
    fontSize: "10px",
    padding: "2px 8px",
    backgroundColor: "rgba(30,144,255,0.15)",
    border: "1px solid rgba(30,144,255,0.3)",
    borderRadius: "20px",
    color: "#1E90FF",
  },
  connectBtn: {
    padding: "8px 16px",
    backgroundColor: "rgba(30,144,255,0.1)",
    border: "1px solid rgba(30,144,255,0.3)",
    borderRadius: "8px",
    color: "#1E90FF",
    cursor: "pointer",
    fontSize: "13px",
    fontFamily: "'DM Mono', monospace",
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "16px",
    padding: "24px",
    marginBottom: "16px",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
  },
  cardTitle: { fontSize: "18px", fontWeight: "700" },
  privacyBadge: {
    display: "flex",
    alignItems: "center",
    padding: "4px 10px",
    backgroundColor: "rgba(30,144,255,0.1)",
    border: "1px solid rgba(30,144,255,0.2)",
    borderRadius: "20px",
    color: "#1E90FF",
  },
  infoBox: {
    backgroundColor: "rgba(30,144,255,0.05)",
    border: "1px solid rgba(30,144,255,0.15)",
    borderRadius: "10px",
    padding: "14px",
    marginBottom: "20px",
  },
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: "8px",
    marginBottom: "8px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  },
  infoLabel: { fontSize: "12px", color: "rgba(255,255,255,0.5)" },
  infoValue: { fontSize: "12px", color: "#1E90FF" },
  tokenRow: { display: "flex", gap: "8px", marginBottom: "20px" },
  tokenBtn: {
    flex: 1,
    padding: "10px",
    backgroundColor: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    color: "rgba(255,255,255,0.5)",
    cursor: "pointer",
    fontSize: "13px",
    fontFamily: "'DM Mono', monospace",
    transition: "all 0.2s",
  },
  tokenBtnActive: {
    backgroundColor: "rgba(30,144,255,0.15)",
    border: "1px solid rgba(30,144,255,0.4)",
    color: "#1E90FF",
  },
  inputGroup: { marginBottom: "16px" },
  label: { display: "block", fontSize: "12px", color: "rgba(255,255,255,0.4)", marginBottom: "8px" },
  input: {
    width: "100%",
    padding: "12px",
    backgroundColor: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    color: "#fff",
    fontSize: "14px",
    fontFamily: "'DM Mono', monospace",
    outline: "none",
    boxSizing: "border-box",
  },
  feeBox: {
    display: "flex",
    justifyContent: "space-between",
    padding: "10px 12px",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: "8px",
    marginBottom: "20px",
  },
  feeText: { fontSize: "12px", color: "rgba(255,255,255,0.4)" },
  feeValue: { fontSize: "12px", color: "rgba(255,255,255,0.6)" },
  sendBtn: {
    width: "100%",
    padding: "14px",
    backgroundColor: "#1E90FF",
    border: "none",
    borderRadius: "10px",
    color: "#fff",
    fontSize: "15px",
    fontWeight: "600",
    cursor: "pointer",
    fontFamily: "'DM Mono', monospace",
    transition: "all 0.2s",
  },
  statusBox: {
    marginTop: "16px",
    padding: "12px",
    backgroundColor: "rgba(30,144,255,0.08)",
    border: "1px solid rgba(30,144,255,0.2)",
    borderRadius: "8px",
  },
  statusText: {
    fontSize: "12px",
    color: "#1E90FF",
    margin: 0,
    whiteSpace: "pre-wrap",
    fontFamily: "'DM Mono', monospace",
  },
  historyCard: {
    backgroundColor: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "16px",
    padding: "20px",
  },
  historyTitle: { fontSize: "14px", color: "rgba(255,255,255,0.4)", marginBottom: "16px" },
  historyItem: {
    paddingBottom: "14px",
    marginBottom: "14px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  },
  historyRow: { display: "flex", justifyContent: "space-between", marginBottom: "4px" },
  historyBadge: { fontSize: "12px", color: "#1E90FF" },
  historyTime: { fontSize: "11px", color: "rgba(255,255,255,0.3)" },
  historyDetails: { fontSize: "12px", color: "rgba(255,255,255,0.5)", marginBottom: "6px" },
  historyLink: { fontSize: "11px", color: "rgba(30,144,255,0.6)", textDecoration: "none" },
};
