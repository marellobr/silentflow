require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();
app.use(cors());
app.use(express.json());

// ─── CONFIG ───────────────────────────────────────────────
const CONTRATO_ENDERECO = "0x3b1958ee8e636d69E868CaFCad3e7dB2eE8B4755";
const CONTRATO_ABI = [
  "function enviar(address payable destinatario) external payable",
  "function enviarToken(address token, address destinatario, uint256 valor) external"
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)"
];
const FEE = 0.002;

// ─── FILA ─────────────────────────────────────────────────
// Cada item: { id, hops: [{from, to, valor, executeAt, done}], token, tokenAddress, decimals, status }
const fila = [];

// ─── UTILS ────────────────────────────────────────────────

function getProvider() {
  return new ethers.JsonRpcProvider(process.env.ALCHEMY_URL);
}

function getMasterWallet() {
  return new ethers.Wallet(process.env.CARTEIRA_PRIVADA, getProvider());
}

// Gera N carteiras efemeras
function gerarCarteiraEfemera() {
  return ethers.Wallet.createRandom().connect(getProvider());
}

// Divide valor em N partes aleatorias que somam o total
function splitAleatorio(total, partes) {
  const floatTotal = parseFloat(total);
  const splits = [];
  let restante = floatTotal;
  for (let i = 0; i < partes - 1; i++) {
    const min = restante * 0.15;
    const max = restante * 0.55;
    const parte = parseFloat((Math.random() * (max - min) + min).toFixed(8));
    splits.push(parte);
    restante = parseFloat((restante - parte).toFixed(8));
  }
  splits.push(parseFloat(restante.toFixed(8)));
  return splits;
}

// Delay aleatorio em ms entre min e max horas
function delayAleatorio(minHoras, maxHoras) {
  const min = minHoras * 3600 * 1000;
  const max = maxHoras * 3600 * 1000;
  return Math.floor(Math.random() * (max - min) + min);
}

// Embaralha array
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Numero aleatorio de hops (2 ou 3)
function numHops() {
  return Math.random() < 0.5 ? 2 : 3;
}

// ─── MONTA PLANO DE HOPS ──────────────────────────────────
// Para cada parte do split, cria cadeia de hops com carteiras efemeras
function montarPlano(destinatario, splits, token, tokenAddress, decimals) {
  const plano = [];
  let tempoBase = Date.now();

  // Embaralha splits para nao sair em ordem
  const splitsEmbaralhados = shuffle([...splits]);

  for (let i = 0; i < splitsEmbaralhados.length; i++) {
    const valor = splitsEmbaralhados[i];
    const hops = numHops();
    const cadeia = [];

    // Gera carteiras intermediarias
    const carteirasIntermedias = [];
    for (let h = 0; h < hops - 1; h++) {
      carteirasIntermedias.push(gerarCarteiraEfemera());
    }

    // Monta hops: master → E1 → E2 → ... → destinatario
    for (let h = 0; h < hops; h++) {
      const de = h === 0 ? "master" : carteirasIntermedias[h - 1].address;
      const deKey = h === 0 ? null : carteirasIntermedias[h - 1].privateKey;
      const para = h === hops - 1 ? destinatario : carteirasIntermedias[h].address;

      // Delay acumulativo aleatorio, cada hop tem delay separado
      const delay = delayAleatorio(
        h === 0 ? 0.016 : 0.5,  // primeiro hop: min 1 min, resto min 30 min
        h === 0 ? 0.5 : 3       // primeiro hop: max 30 min, resto max 3h
      );
      tempoBase += delay + (i * delayAleatorio(0.1, 1) * 1000); // embaralha entre splits

      cadeia.push({
        hopIndex: h,
        de,
        deKey,
        para,
        valor: valor.toFixed(8),
        executeAt: tempoBase,
        done: false,
        tentativas: 0
      });
    }

    plano.push({
      splitIndex: i,
      valorOriginal: valor,
      cadeia
    });
  }

  return plano;
}

// ─── EXECUTA HOP ETH ──────────────────────────────────────
async function executarHopETH(hop) {
  const provider = getProvider();
  let signer;

  if (hop.de === "master") {
    signer = getMasterWallet();
  } else {
    signer = new ethers.Wallet(hop.deKey, provider);
  }

  const valor = ethers.parseEther(hop.valor);
  const gasPrice = (await provider.getFeeData()).gasPrice;
  const gasCusto = gasPrice * 21000n;

  // Se nao for o ultimo hop, reserva gas
  const valorEnviar = hop.para === hop.para ? valor - gasCusto : valor;

  const tx = await signer.sendTransaction({
    to: hop.para,
    value: valorEnviar > 0n ? valorEnviar : valor,
    gasLimit: 21000
  });
  await tx.wait();
  console.log("Hop ETH executado:", hop.de.slice(0,8), "->", hop.para.slice(0,8), "| valor:", hop.valor, "| tx:", tx.hash);
  return tx.hash;
}

// ─── EXECUTA HOP TOKEN ────────────────────────────────────
async function executarHopToken(hop, tokenAddress, decimals) {
  const provider = getProvider();
  let signer;

  if (hop.de === "master") {
    signer = getMasterWallet();
  } else {
    signer = new ethers.Wallet(hop.deKey, provider);
  }

  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const valor = ethers.parseUnits(hop.valor, decimals);
  const tx = await tokenContract.transfer(hop.para, valor);
  await tx.wait();
  console.log("Hop TOKEN executado:", hop.de.slice(0,8), "->", hop.para.slice(0,8), "| valor:", hop.valor);
  return tx.hash;
}

// ─── DUMMY TRANSACTION ────────────────────────────────────
async function enviarDummy() {
  try {
    const provider = getProvider();
    const master = getMasterWallet();
    const dummy = gerarCarteiraEfemera();
    const valorDummy = ethers.parseEther((Math.random() * 0.005 + 0.001).toFixed(6));
    const gasPrice = (await provider.getFeeData()).gasPrice;

    // Envia pequeno valor para carteira efemera aleatoria (ruido)
    const tx = await master.sendTransaction({
      to: dummy.address,
      value: valorDummy,
      gasLimit: 21000,
      gasPrice
    });
    await tx.wait();

    // Devolve imediatamente com delay curto
    setTimeout(async () => {
      try {
        const dummySigner = dummy.connect(provider);
        const saldo = await provider.getBalance(dummy.address);
        const gasCusto = gasPrice * 21000n;
        if (saldo > gasCusto) {
          await dummySigner.sendTransaction({
            to: master.address,
            value: saldo - gasCusto,
            gasLimit: 21000,
            gasPrice
          });
        }
      } catch(e) {}
    }, delayAleatorio(0.016, 0.1));

    console.log("Dummy transaction enviada para:", dummy.address.slice(0,10));
  } catch(e) {
    console.log("Erro dummy tx:", e.message);
  }
}

// ─── PROCESSA FILA ────────────────────────────────────────
setInterval(async () => {
  const agora = Date.now();

  for (const tx of fila) {
    if (tx.status === "concluido" || tx.status === "erro") continue;

    for (const split of tx.plano) {
      for (const hop of split.cadeia) {
        if (hop.done) continue;
        if (hop.executeAt > agora) continue;

        // Verifica se hop anterior foi concluido
        if (hop.hopIndex > 0) {
          const hopAnterior = split.cadeia[hop.hopIndex - 1];
          if (!hopAnterior.done) continue;
        }

        // Marca como processando
        hop.processando = true;
        hop.tentativas++;

        try {
          let hash;
          if (tx.token === "ETH") {
            hash = await executarHopETH(hop);
          } else {
            hash = await executarHopToken(hop, tx.tokenAddress, tx.decimals);
          }
          hop.done = true;
          hop.hash = hash;
          hop.processando = false;

          // Envia dummy apos cada hop real
          if (Math.random() < 0.6) {
            setTimeout(() => enviarDummy(), delayAleatorio(0.016, 0.25));
          }

        } catch(err) {
          hop.processando = false;
          console.error("Erro no hop:", err.message);
          if (hop.tentativas >= 3) {
            tx.status = "erro";
            console.error("TX falhou apos 3 tentativas:", tx.id);
          }
        }
      }
    }

    // Verifica se todos os hops foram concluidos
    const totalHops = tx.plano.reduce((sum, s) => sum + s.cadeia.length, 0);
    const hopsFeitos = tx.plano.reduce((sum, s) => sum + s.cadeia.filter(h => h.done).length, 0);
    if (hopsFeitos === totalHops) {
      tx.status = "concluido";
      console.log("TX concluida:", tx.id, "| splits:", tx.plano.length, "| hops totais:", totalHops);
    }
  }
}, 15000); // Verifica a cada 15 segundos

// ─── ENDPOINTS ────────────────────────────────────────────

// Agendar transacao silenciosa com split + multi-hop
app.post("/agendar", (req, res) => {
  const { destinatario, valor, token, tokenAddress, decimals } = req.body;

  if (!destinatario || !valor || !token) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  // Desconta fee
  const valorLiquido = (parseFloat(valor) * (1 - FEE)).toFixed(8);

  // Numero de splits: 2, 3 ou 4 aleatorio
  const numSplits = Math.floor(Math.random() * 3) + 2;
  const splits = splitAleatorio(valorLiquido, numSplits);

  // Monta plano de hops
  const plano = montarPlano(destinatario, splits, token, tokenAddress, decimals || 18);

  // Calcula tempo estimado (ultimo executeAt)
  let maxExecuteAt = 0;
  plano.forEach(s => s.cadeia.forEach(h => { if (h.executeAt > maxExecuteAt) maxExecuteAt = h.executeAt; }));
  const horasEstimadas = ((maxExecuteAt - Date.now()) / 3600000).toFixed(1);

  const txEntry = {
    id: Date.now().toString(),
    destinatario,
    valorOriginal: valor,
    valorLiquido,
    token,
    tokenAddress: tokenAddress || null,
    decimals: decimals || 18,
    plano,
    status: "pendente",
    numSplits,
    criadoEm: new Date().toISOString()
  };

  fila.push(txEntry);

  console.log("TX agendada:", txEntry.id, "| splits:", numSplits, "| estimativa:", horasEstimadas, "h");

  res.json({
    sucesso: true,
    id: txEntry.id,
    numSplits,
    horasEstimadas,
    mensagem: "Transacao agendada com " + numSplits + " splits e multi-hop. Estimativa: ~" + horasEstimadas + "h"
  });
});

// Status de uma transacao
app.get("/status/:id", (req, res) => {
  const tx = fila.find(t => t.id === req.params.id);
  if (!tx) return res.json({ status: "nao_encontrado" });

  const totalHops = tx.plano.reduce((sum, s) => sum + s.cadeia.length, 0);
  const hopsFeitos = tx.plano.reduce((sum, s) => sum + s.cadeia.filter(h => h.done).length, 0);

  let maxExecuteAt = 0;
  tx.plano.forEach(s => s.cadeia.forEach(h => { if (!h.done && h.executeAt > maxExecuteAt) maxExecuteAt = h.executeAt; }));
  const minutosRestantes = Math.ceil(Math.max(0, maxExecuteAt - Date.now()) / 60000);

  res.json({
    status: tx.status,
    progresso: hopsFeitos + "/" + totalHops + " hops",
    minutosRestantes,
    numSplits: tx.numSplits
  });
});

// Health check
app.get("/health", (req, res) => res.json({ ok: true, filaSize: fila.length }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log("SilentFlow v2 backend rodando na porta", PORT));
