const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_URL);

// ─── Config ───────────────────────────────────────────────────────────────────
const CONTRACT_ADDRESS = "0xAdcBABf7CB3cE55559b2A3ca81f75bbBC147565b";
const CONTRACT_ABI = [
  "function depositETH(address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external payable",
  "function depositToken(address token, uint256 amount, address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external",
];
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
const TOKENS = {
  USDC: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 },
  USDT: { address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0", decimals: 6 },
};

// Taxa de privacidade (0.2%)
const TAXA_BPS = 20n; // basis points: 20/10000 = 0.2%

// Valor mínimo configurável por env (default: 0.005 ETH para testnet)
const MIN_ETH  = ethers.parseEther(process.env.MIN_ETH  || "0.005");
const MIN_USDC = ethers.parseUnits(process.env.MIN_USDC || "5", 6);
const MIN_USDT = ethers.parseUnits(process.env.MIN_USDT || "5", 6);

function getMinimo(token) {
  if (token === "ETH")  return MIN_ETH;
  if (token === "USDC") return MIN_USDC;
  if (token === "USDT") return MIN_USDT;
  return 0n;
}

// masterWallet: financia gas das wallets efêmeras e coleta taxas
const masterWallet = new ethers.Wallet(process.env.CARTEIRA_PRIVADA, provider);

// Mapa de entradas descartáveis: endereço → { wallet, token, stealthAddress, ephemeralPubKey, viewTag, criadoEm }
const entradasPendentes = new Map();

// Fila de pipelines em memória
const fila = new Map();

// Flag para evitar dummy durante fase de funding
let pipelineAtivo = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function delayAleatorio(minS = 30, maxS = 120) {
  return (minS + Math.random() * (maxS - minS)) * 1000;
}

function splitAleatorio(total, partes) {
  const vals = [];
  let restante = total;
  for (let i = 0; i < partes - 1; i++) {
    const min = restante / 5n;
    const max = restante / 2n;
    const range = max - min;
    const rand = BigInt(Math.floor(Math.random() * Number(range)));
    vals.push(min + rand);
    restante -= min + rand;
  }
  vals.push(restante);
  return vals.sort(() => Math.random() - 0.5);
}

// Desconta taxa de 0.2% — retorna { valorLiquido, taxa }
function descontarTaxa(valorBruto) {
  const taxa = (valorBruto * TAXA_BPS) / 10000n;
  const valorLiquido = valorBruto - taxa;
  return { valorLiquido, taxa };
}

async function getGasPrice() {
  const feeData = await provider.getFeeData();
  return feeData.gasPrice;
}

async function estimarCustoGasETH() {
  return (await getGasPrice()) * 21000n;
}

async function estimarCustoGasDeposit() {
  return (await getGasPrice()) * 120000n;
}

async function financiarGas(destino) {
  const valor = (await estimarCustoGasETH()) * 4n;
  const tx = await masterWallet.sendTransaction({
    to: destino,
    value: valor,
    gasLimit: 21000n,
  });
  await tx.wait();
  return valor;
}

// ─── ETH hops ─────────────────────────────────────────────────────────────────

async function hopETH(deWallet, paraEndereco) {
  const gasPrice = await getGasPrice();
  const gasCost  = gasPrice * 21000n;
  const saldo    = await provider.getBalance(deWallet.address);
  const enviar   = saldo - gasCost;
  if (enviar <= 0n) { console.error(`hopETH: saldo insuficiente em ${deWallet.address}`); return false; }
  try {
    const tx = await deWallet.sendTransaction({ to: paraEndereco, value: enviar, gasLimit: 21000n, gasPrice });
    await tx.wait();
    console.log(`  ✓ ETH hop: ${deWallet.address.slice(0,8)}... → ${paraEndereco.slice(0,8)}... (${ethers.formatEther(enviar)} ETH)`);
    return true;
  } catch (e) { console.error(`  ✗ hopETH: ${e.message}`); return false; }
}

async function depositarETHNoContrato(wallet, stealthAddress, ephemeralPubKey, viewTag) {
  const gasPrice = await getGasPrice();
  const gasLimit = 120000n;
  const saldo    = await provider.getBalance(wallet.address);
  const valor    = saldo - (gasPrice * gasLimit);
  if (valor <= 0n) { console.error(`depositarETH: saldo insuficiente`); return null; }
  const contrato = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
  try {
    const tx = await contrato.depositETH(stealthAddress, ephemeralPubKey, viewTag, { value: valor, gasLimit, gasPrice });
    await tx.wait();
    console.log(`  ✓ depositETH: ${ethers.formatEther(valor)} ETH → stealth ${stealthAddress.slice(0,10)}...`);
    return tx.hash;
  } catch (e) { console.error(`  ✗ depositETH: ${e.message}`); return null; }
}

// ─── Token hops ───────────────────────────────────────────────────────────────

async function hopToken(deWallet, paraEndereco, tokenAddress, valor) {
  await financiarGas(deWallet.address);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, deWallet);
  try {
    const tx = await token.transfer(paraEndereco, valor);
    await tx.wait();
    console.log(`  ✓ Token hop: ${deWallet.address.slice(0,8)}... → ${paraEndereco.slice(0,8)}...`);
    return true;
  } catch (e) { console.error(`  ✗ hopToken: ${e.message}`); return false; }
}

async function depositarTokenNoContrato(wallet, tokenAddress, valor, stealthAddress, ephemeralPubKey, viewTag) {
  await financiarGas(wallet.address);
  const tokenContract   = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const contratoContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
  try {
    const approveTx = await tokenContract.approve(CONTRACT_ADDRESS, valor);
    await approveTx.wait();
    const gasPrice = await getGasPrice();
    const tx = await contratoContract.depositToken(tokenAddress, valor, stealthAddress, ephemeralPubKey, viewTag, { gasLimit: 150000n, gasPrice });
    await tx.wait();
    console.log(`  ✓ depositToken → stealth ${stealthAddress.slice(0,10)}...`);
    return tx.hash;
  } catch (e) { console.error(`  ✗ depositToken: ${e.message}`); return null; }
}

// ─── Dummy noise ──────────────────────────────────────────────────────────────

async function enviarDummy() {
  if (pipelineAtivo) return;
  if (Math.random() > 0.5) return;
  try {
    const efemero  = ethers.Wallet.createRandom();
    const gasPrice = await getGasPrice();
    await masterWallet.sendTransaction({
      to: efemero.address, value: ethers.parseEther("0.00001"), gasLimit: 21000n, gasPrice,
    });
    console.log(`  ~ dummy noise → ${efemero.address.slice(0,10)}...`);
  } catch { /* silencioso */ }
}

// ─── Pipeline ETH ─────────────────────────────────────────────────────────────

async function executarPipelineETH(txId, valorBruto, stealthAddress, ephemeralPubKey, viewTag) {
  const tx = fila.get(txId);
  if (!tx) return;

  // Desconta taxa — fica na master wallet como receita
  const { valorLiquido, taxa } = descontarTaxa(valorBruto);
  console.log(`  💰 Taxa coletada: ${ethers.formatEther(taxa)} ETH | Líquido: ${ethers.formatEther(valorLiquido)} ETH`);

  const numSplits      = 2 + Math.floor(Math.random() * 2); // 2 ou 3
  const numHopsPerSplit = 2;
  const partes = splitAleatorio(valorLiquido, numSplits);

  tx.hopsTotal = partes.length * numHopsPerSplit;
  tx.hopsFeitos = 0;
  tx.splits = partes.length;

  console.log(`\n🔀 Pipeline ETH [${txId}]: ${partes.length} splits, ${numHopsPerSplit} hops cada`);

  // Cria cadeias efêmeras
  const cadeias = partes.map(() =>
    Array.from({ length: numHopsPerSplit }, () => ethers.Wallet.createRandom().connect(provider))
  );

  // FASE 1: Financia em série (evita conflito de nonce)
  pipelineAtivo = true;
  const gasDeposit = await estimarCustoGasDeposit();
  const gasHops    = (await estimarCustoGasETH()) * BigInt(numHopsPerSplit);
  const gasExtra   = await estimarCustoGasETH();

  for (let i = 0; i < partes.length; i++) {
    const valorComGas = partes[i] + gasDeposit + gasHops + gasExtra;
    console.log(`  Split ${i + 1}: ${ethers.formatEther(partes[i])} ETH`);
    const txFund = await masterWallet.sendTransaction({
      to: cadeias[i][0].address, value: valorComGas, gasLimit: 21000n,
    });
    await txFund.wait();
    console.log(`  → Funded E${i+1}[0]: ${cadeias[i][0].address.slice(0,10)}...`);
  }
  pipelineAtivo = false;

  // FASE 2: Hops em paralelo
  const promessas = partes.map(async (valorParte, i) => {
    const cadeia = cadeias[i];
    try {
      // Hops intermediários com delay
      for (let h = 0; h < cadeia.length - 1; h++) {
        const delay = delayAleatorio(30, 120);
        console.log(`  ⏱ Split ${i+1} hop ${h+1}: aguardando ${Math.round(delay/1000)}s...`);
        await sleep(delay);
        await enviarDummy();
        const ok = await hopETH(cadeia[h], cadeia[h + 1].address);
        if (!ok) throw new Error(`Hop ${h} falhou no split ${i}`);
        tx.hopsFeitos++;
      }

      // Delay final + depósito no contrato
      const delayFinal = delayAleatorio(30, 120);
      console.log(`  ⏱ Split ${i+1} depósito final: aguardando ${Math.round(delayFinal/1000)}s...`);
      await sleep(delayFinal);

      const depositHash = await depositarETHNoContrato(cadeia[cadeia.length - 1], stealthAddress, ephemeralPubKey, viewTag);
      tx.hopsFeitos++;

      if (!depositHash) throw new Error(`Depósito final falhou no split ${i}`);
      console.log(`  ✅ Split ${i+1} concluído`);
      return depositHash;

    } catch (e) {
      console.error(`  ✗ Split ${i} falhou: ${e.message} — fallback direto`);
      try {
        const gasPrice = await getGasPrice();
        const c = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, masterWallet);
        const txFb = await c.depositETH(stealthAddress, ephemeralPubKey, viewTag, { value: valorParte, gasLimit: 120000n, gasPrice });
        await txFb.wait();
        return txFb.hash;
      } catch (e2) { console.error(`  ✗ Fallback falhou: ${e2.message}`); return null; }
    }
  });

  const resultados = await Promise.allSettled(promessas);
  tx.concluido = true;
  tx.depositHashes = resultados.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  console.log(`\n✅ Pipeline ETH [${txId}] concluído — ${tx.depositHashes.length}/${partes.length} splits\n`);
}

// ─── Pipeline Token ───────────────────────────────────────────────────────────

async function executarPipelineToken(txId, tokenAddress, valorBruto, stealthAddress, ephemeralPubKey, viewTag) {
  const tx = fila.get(txId);
  if (!tx) return;

  const { valorLiquido, taxa } = descontarTaxa(valorBruto);
  console.log(`  💰 Taxa coletada: ${taxa.toString()} units | Líquido: ${valorLiquido.toString()} units`);

  const numSplits = 2;
  const numHopsPerSplit = 2;
  const partes = splitAleatorio(valorLiquido, numSplits);

  tx.hopsTotal = partes.length * numHopsPerSplit;
  tx.hopsFeitos = 0;
  tx.splits = partes.length;

  console.log(`\n🔀 Pipeline Token [${txId}]: ${partes.length} splits`);

  // Token: hops em série pois cada um precisa financiar gas da master (sem conflito, mas serial)
  const depositHashes = [];
  for (let i = 0; i < partes.length; i++) {
    const valorParte = partes[i];
    try {
      const cadeia = Array.from({ length: numHopsPerSplit }, () =>
        ethers.Wallet.createRandom().connect(provider)
      );

      // Master → E[0] (token)
      await hopToken(masterWallet, cadeia[0].address, tokenAddress, valorParte);
      console.log(`  → Funded E${i+1}[0] com tokens`);

      // Hops intermediários
      for (let h = 0; h < cadeia.length - 1; h++) {
        const delay = delayAleatorio(30, 120);
        console.log(`  ⏱ Split ${i+1} hop ${h+1}: aguardando ${Math.round(delay/1000)}s...`);
        await sleep(delay);
        await enviarDummy();
        const saldo = await new ethers.Contract(tokenAddress, ERC20_ABI, provider).balanceOf(cadeia[h].address);
        const ok = await hopToken(cadeia[h], cadeia[h+1].address, tokenAddress, saldo);
        if (!ok) throw new Error(`Token hop ${h} falhou`);
        tx.hopsFeitos++;
      }

      const delayFinal = delayAleatorio(30, 120);
      await sleep(delayFinal);

      const saldoFinal = await new ethers.Contract(tokenAddress, ERC20_ABI, provider).balanceOf(cadeia[cadeia.length-1].address);
      const hash = await depositarTokenNoContrato(cadeia[cadeia.length-1], tokenAddress, saldoFinal, stealthAddress, ephemeralPubKey, viewTag);
      tx.hopsFeitos++;
      if (hash) depositHashes.push(hash);
      console.log(`  ✅ Split ${i+1} token concluído`);

    } catch (e) {
      console.error(`  ✗ Split token ${i} falhou: ${e.message} — fallback`);
      try {
        const hash = await depositarTokenNoContrato(masterWallet, tokenAddress, valorParte, stealthAddress, ephemeralPubKey, viewTag);
        if (hash) depositHashes.push(hash);
      } catch { /* silencioso */ }
    }
  }

  tx.concluido = true;
  tx.depositHashes = depositHashes;
  console.log(`\n✅ Pipeline Token [${txId}] concluído\n`);
}

// ─── Monitoramento de entradas descartáveis ───────────────────────────────────
// Verifica a cada 10s se alguma entrada pendente recebeu fundos

async function monitorarEntradas() {
  for (const [endereco, entrada] of entradasPendentes.entries()) {
    // Expira após 30 minutos sem uso
    if (Date.now() - entrada.criadoEm > 30 * 60 * 1000) {
      console.log(`⏰ Entrada expirada: ${endereco.slice(0,10)}...`);
      entradasPendentes.delete(endereco);
      continue;
    }

    try {
      let valorRecebido = 0n;

      if (entrada.token === "ETH") {
        valorRecebido = await provider.getBalance(endereco);
      } else {
        const tokenInfo = TOKENS[entrada.token];
        if (!tokenInfo) continue;
        valorRecebido = await new ethers.Contract(tokenInfo.address, ERC20_ABI, provider).balanceOf(endereco);
      }

      if (valorRecebido === 0n) continue;

      // Verifica mínimo
      const minimo = getMinimo(entrada.token);
      if (valorRecebido < minimo) {
        console.log(`⚠️  Entrada ${endereco.slice(0,10)}... recebeu ${valorRecebido} mas mínimo é ${minimo} — aguardando mais`);
        continue;
      }

      console.log(`\n💸 Entrada detectada: ${endereco.slice(0,10)}... recebeu ${entrada.token === 'ETH' ? ethers.formatEther(valorRecebido) : valorRecebido.toString()} ${entrada.token}`);

      // Remove da fila de monitoramento imediatamente
      entradasPendentes.delete(endereco);

      // Para ETH: move o ETH da wallet de entrada para a master, depois dispara pipeline
      // Para token: tokens já estão na wallet de entrada, dispara pipeline direto
      const id = `sf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      fila.set(id, {
        id,
        token: entrada.token,
        valorTotal: valorRecebido.toString(),
        stealthAddress: entrada.stealthAddress,
        ephemeralPubKey: entrada.ephemeralPubKey,
        viewTag: entrada.viewTag,
        hopsFeitos: 0,
        hopsTotal: 4,
        splits: 2,
        concluido: false,
        criadoEm: Date.now(),
        depositHashes: [],
      });

      // Notifica frontend via polling (o pendingId já está salvo no frontend)
      entrada.resolveId && entrada.resolveId(id);

      if (entrada.token === "ETH") {
        // Move ETH da entrada para a master (consolidação), depois pipeline
        const gasPrice = await getGasPrice();
        const gasCost  = gasPrice * 21000n;
        const enviar   = valorRecebido - gasCost;
        if (enviar > 0n) {
          const txMove = await entrada.wallet.sendTransaction({
            to: masterWallet.address, value: enviar, gasLimit: 21000n, gasPrice,
          });
          await txMove.wait();
          console.log(`  → ETH consolidado na master: ${ethers.formatEther(enviar)} ETH`);
        }
        executarPipelineETH(id, valorRecebido, entrada.stealthAddress, entrada.ephemeralPubKey, entrada.viewTag)
          .catch(e => console.error(`Pipeline ETH erro:`, e.message));
      } else {
        executarPipelineToken(id, TOKENS[entrada.token].address, valorRecebido, entrada.stealthAddress, entrada.ephemeralPubKey, entrada.viewTag)
          .catch(e => console.error(`Pipeline Token erro:`, e.message));
      }

    } catch (e) {
      console.error(`Erro monitorando ${endereco.slice(0,10)}...: ${e.message}`);
    }
  }
}

setInterval(monitorarEntradas, 10000);

// ─── Endpoints ────────────────────────────────────────────────────────────────

// GET /entrada
// Gera uma wallet descartável de entrada para o usuário enviar fundos
// Query: ?token=ETH&stealthAddress=0x...&ephemeralPubKey=0x...&viewTag=N
app.get("/entrada", (req, res) => {
  try {
    const { token, stealthAddress, ephemeralPubKey, viewTag } = req.query;

    if (!token || !stealthAddress || !ephemeralPubKey || viewTag === undefined) {
      return res.status(400).json({ erro: "Parâmetros incompletos" });
    }

    const minimo = getMinimo(token);
    const wallet = ethers.Wallet.createRandom().connect(provider);

    entradasPendentes.set(wallet.address, {
      wallet,
      token,
      stealthAddress,
      ephemeralPubKey,
      viewTag: parseInt(viewTag),
      criadoEm: Date.now(),
      resolveId: null,
    });

    console.log(`🚪 Nova entrada gerada: ${wallet.address.slice(0,10)}... [${token}]`);

    res.json({
      entradaAddress: wallet.address,
      token,
      minimoWei: minimo.toString(),
      minimoFormatado: token === "ETH"
        ? ethers.formatEther(minimo) + " ETH"
        : ethers.formatUnits(minimo, 6) + " " + token,
      expiresIn: 1800, // 30 min em segundos
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

// GET /aguardar/:endereco
// Frontend faz polling para saber se a entrada recebeu fundos e qual é o id do pipeline
app.get("/aguardar/:endereco", (req, res) => {
  const entrada = entradasPendentes.get(req.params.endereco);

  if (!entrada) {
    // Não está mais pendente — pode ter sido processada
    // Busca na fila pelo stealthAddress mais recente
    for (const [id, tx] of [...fila.entries()].reverse()) {
      if (tx.stealthAddress === req.params.stealthAddress) {
        return res.json({ recebido: true, id });
      }
    }
    return res.json({ recebido: true, id: null });
  }

  res.json({ recebido: false });
});

// GET /status/:id
app.get("/status/:id", (req, res) => {
  const tx = fila.get(req.params.id);
  if (!tx) return res.status(404).json({ erro: "Não encontrado" });

  const hopsFeitos    = tx.hopsFeitos || 0;
  const hopsTotal     = tx.hopsTotal  || 4;
  const hopsRestantes = Math.max(0, hopsTotal - hopsFeitos);
  const minutosRestantes = Math.ceil(hopsRestantes * 2);

  res.json({
    concluido: tx.concluido || false,
    hopsFeitos,
    hopsTotal,
    minutosRestantes,
    splits: tx.splits || 2,
    depositHashes: tx.depositHashes || [],
  });
});

// GET /minimos — retorna valores mínimos para o frontend mostrar
app.get("/minimos", (req, res) => {
  res.json({
    ETH:  { wei: MIN_ETH.toString(),  formatado: ethers.formatEther(MIN_ETH) + " ETH" },
    USDC: { wei: MIN_USDC.toString(), formatado: ethers.formatUnits(MIN_USDC, 6) + " USDC" },
    USDT: { wei: MIN_USDT.toString(), formatado: ethers.formatUnits(MIN_USDT, 6) + " USDT" },
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, filaSize: fila.size, entradasPendentes: entradasPendentes.size });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 SilentFlow backend v4 (entrada descartável + taxa + mínimos) — porta ${PORT}`);
  console.log(`📬 Master wallet: ${masterWallet.address}`);
  console.log(`💰 Taxa: 0.2% | Mínimos: ${ethers.formatEther(MIN_ETH)} ETH / ${ethers.formatUnits(MIN_USDC,6)} USDC / ${ethers.formatUnits(MIN_USDT,6)} USDT`);
});
