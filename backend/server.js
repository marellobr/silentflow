require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();
app.use(cors());
app.use(express.json());

const CONTRATO_ENDERECO = "0x3b1958ee8e636d69E868CaFCad3e7dB2eE8B4755";
const CONTRATO_ABI = [
  "function enviar(address payable destinatario) external payable",
  "function enviarToken(address token, address destinatario, uint256 valor) external"
];

// Fila de transações pendentes
const fila = [];

// Processa a fila a cada 30 segundos
setInterval(async () => {
  const agora = Date.now();
  const pendentes = fila.filter(tx => tx.executeAt <= agora && !tx.processando);
  
  for (const tx of pendentes) {
    tx.processando = true;
    try {
      const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_URL);
      const carteira = new ethers.Wallet(process.env.CARTEIRA_PRIVADA, provider);
      const contrato = new ethers.Contract(CONTRATO_ENDERECO, CONTRATO_ABI, carteira);

      console.log("Processando TX para:", tx.destinatario);

      if (tx.token === "ETH") {
        const txRes = await contrato.enviar(tx.destinatario, {
          value: ethers.parseEther(tx.valor),
          gasLimit: 60000
        });
        await txRes.wait();
        console.log("ETH enviado:", txRes.hash);
      } else {
        const valorParsed = ethers.parseUnits(tx.valor, tx.decimals);
        const txRes = await contrato.enviarToken(tx.tokenAddress, tx.destinatario, valorParsed, {
          gasLimit: 120000
        });
        await txRes.wait();
        console.log("Token enviado:", txRes.hash);
      }

      // Remove da fila
      const idx = fila.indexOf(tx);
      if (idx > -1) fila.splice(idx, 1);

    } catch (err) {
      console.error("Erro ao processar TX:", err.message);
      tx.processando = false;
    }
  }
}, 30000);

// Endpoint: agendar transação com delay
app.post("/agendar", (req, res) => {
  const { destinatario, valor, token, tokenAddress, decimals } = req.body;

  if (!destinatario || !valor || !token) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  // Delay aleatório entre 1 e 6 horas em milissegundos
  const minDelay = 1 * 60 * 60 * 1000;
  const maxDelay = 6 * 60 * 60 * 1000;
  const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  const executeAt = Date.now() + delay;

  const tx = {
    id: Date.now().toString(),
    destinatario,
    valor,
    token,
    tokenAddress: tokenAddress || null,
    decimals: decimals || 18,
    executeAt,
    processando: false,
    criadoEm: new Date().toISOString()
  };

  fila.push(tx);

  const horasRestantes = (delay / 3600000).toFixed(1);
  console.log("TX agendada para daqui", horasRestantes, "horas");

  res.json({
    sucesso: true,
    id: tx.id,
    executeAt,
    horasRestantes,
    mensagem: "Transacao agendada com delay de " + horasRestantes + "h"
  });
});

// Endpoint: verificar status
app.get("/status/:id", (req, res) => {
  const tx = fila.find(t => t.id === req.params.id);
  if (!tx) return res.json({ status: "concluido" });
  const restante = Math.max(0, tx.executeAt - Date.now());
  const minutosRestantes = Math.ceil(restante / 60000);
  res.json({ status: "pendente", minutosRestantes, executeAt: tx.executeAt });
});

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log("SilentFlow backend rodando na porta", PORT));