const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_URL);

const CONTRACT_ADDRESS = "0x7737DC1716680742E659B3fC97c85807089240e9";
const CONTRACT_ABI = [
  "function depositETH(address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external payable",
];
const masterWallet = new ethers.Wallet(process.env.CARTEIRA_PRIVADA, provider);

// Fila de transações
const fila = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitAleatorio(total, partes) {
  const vals = [];
  let restante = total;
  for (let i = 0; i < partes - 1; i++) {
    const min = restante * 0.15;
    const max = restante * 0.55;
    const val = min + Math.random() * (max - min);
    vals.push(val);
    restante -= val;
  }
  vals.push(restante);
  return vals.sort(() => Math.random() - 0.5);
}

// Delay de 30s a 3 minutos (em ms)
function delayAleatorio() {
  const minMs = 30 * 1000;
  const maxMs = 3 * 60 * 1000;
  return minMs + Math.random() * (maxMs - minMs);
}

function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

function numHops() {
  return 2; // fixed 2 hops for speed
}

// ─── Planejamento ─────────────────────────────────────────────────────────────

function montarPlano(numSplits) {
  // Creates dummy hop chains for noise — does NOT move real funds
  // Real funds stay in the contract until recipient withdraws
  return Array.from({ length: numSplits }, (_, i) => {
    const hops = numHops();
    const cadeia = Array.from({ length: hops }, (_, h) => ({
      hopIndex: h,
      wallet: ethers.Wallet.createRandom(),
      isLast: h === hops - 1,
      executadoEm: 0,
    }));
    return { splitIndex: i, cadeia, concluido: false, hopAtual: 0 };
  });
}

// ─── Execução ─────────────────────────────────────────────────────────────────

async function executarHopETH(de, para, valor) {
  try {
    const deWallet = de.connect(provider);
    const gasPrice = (await provider.getFeeData()).gasPrice;
    const gasLimit = 21000n;
    const gasCost = gasPrice * gasLimit;
    const enviar = valor - gasCost;
    if (enviar <= 0n) return false;

    const tx = await deWallet.sendTransaction({
      to: para,
      value: enviar,
      gasLimit,
      gasPrice,
    });
    await tx.wait();
    return true;
  } catch (e) {
    console.error("Hop ETH falhou:", e.message);
    return false;
  }
}

async function executarHopToken(de, para, tokenAddress, valor) {
  const ERC20_ABI = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ];
  try {
    const deWallet = de.connect(provider);
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, deWallet);
    const tx = await token.transfer(para, valor);
    await tx.wait();
    return true;
  } catch (e) {
    console.error("Hop Token falhou:", e.message);
    return false;
  }
}

async function enviarDummy(de) {
  if (Math.random() > 0.6) return; // 40% de chance de não enviar
  try {
    const efemero = ethers.Wallet.createRandom().connect(provider);
    const deWallet = de.connect(provider);
    const gasPrice = (await provider.getFeeData()).gasPrice;
    const dummyValue = ethers.parseEther("0.00001");
    await deWallet.sendTransaction({
      to: efemero.address,
      value: dummyValue,
      gasLimit: 21000n,
      gasPrice,
    });
  } catch (e) {
    // dummy pode falhar silenciosamente
  }
}

// ─── Processador da fila ──────────────────────────────────────────────────────

async function processarFila() {
  for (const [id, tx] of fila.entries()) {
    if (tx.concluido) continue;

    for (const parte of tx.partes) {
      if (parte.concluido) continue;

      const hop = parte.cadeia[parte.hopAtual];
      if (!hop || hop.executadoEm > Date.now()) continue;

      // Dummy hop: just send tiny ETH between ephemeral wallets for noise
      // Real funds stay in the contract until recipient calls withdraw()
      try {
        await enviarDummy(masterWallet);
        console.log(`Dummy hop ${parte.hopAtual + 1}/${parte.cadeia.length} para tx ${id}`);
        parte.hopAtual++;
        tx.hopsFeitos++;

        if (parte.hopAtual >= parte.cadeia.length) {
          parte.concluido = true;
        } else {
          parte.cadeia[parte.hopAtual].executadoEm = Date.now() + delayAleatorio();
        }
      } catch (e) {
        console.error("Erro no dummy hop:", e.message);
        hop.tentativas = (hop.tentativas || 0) + 1;
        if (hop.tentativas >= 3) parte.concluido = true;
      }
    }

    const todasConcluidas = tx.partes.every((p) => p.concluido);
    if (todasConcluidas) {
      tx.concluido = true;
      console.log(`✅ Transação ${id} concluída (fundos no contrato prontos para saque).`);
    }
  }
}

setInterval(processarFila, 15000);

// ─── Endpoints ────────────────────────────────────────────────────────────────

app.post("/agendar", async (req, res) => {
  try {
    const { txHash, destinatario, valor, token } = req.body;
    const id = `sf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const numSplits = 2; // fixed 2 splits for speed
    const partes = montarPlano(numSplits);

    // Agenda primeiro hop de cada parte com delay
    partes.forEach((p) => {
      p.hopsFeitos = 0;
      p.cadeia[0].executadoEm = Date.now() + delayAleatorio();
    });

    const hopsTotal = partes.reduce((acc, p) => acc + p.cadeia.length, 0);

    fila.set(id, {
      id,
      txHash,
      token,
      partes,
      hopsFeitos: 0,
      hopsTotal,
      concluido: false,
      criadoEm: Date.now(),
    });

    // Estimativa: hopsTotal * delay max (3 min each)
    const estimativaMinutos = Math.min(hopsTotal * 3, 10);

    console.log(`📥 Nova tx agendada: ${id} — ${numSplits} splits, ${hopsTotal} hops`);

    res.json({
      id,
      splits: numSplits,
      hopsTotal,
      estimativaMinutos,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

app.get("/status/:id", (req, res) => {
  const tx = fila.get(req.params.id);
  if (!tx) return res.status(404).json({ erro: "Não encontrado" });

  const hopsFeitos  = tx.hopsFeitos || 0;
  const hopsTotal   = tx.hopsTotal  || 1;
  const hopsRestantes = hopsTotal - hopsFeitos;
  // Each remaining hop takes up to 3 min
  const minutosRestantes = (hopsRestantes * 3).toFixed(0);

  res.json({
    concluido: tx.concluido || false,
    hopsFeitos,
    hopsTotal,
    minutosRestantes,
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, filaSize: fila.size });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 SilentFlow backend v2 rodando na porta ${PORT}`));
