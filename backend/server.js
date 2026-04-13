const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_URL);

const CONTRACT_ADDRESS = "0x99f4a6Deb7643a1DDa10115BFE3c7a4D9C4Ef09B";
const CONTRACT_ABI = [
  "function depositETH(address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external payable",
  "function depositETHTimelocked(address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external payable",
  "function depositToken(address token, uint256 amount, address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external",
  "function depositTokenTimelocked(address token, uint256 amount, address stealthAddress, bytes calldata ephemeralPubKey, uint8 viewTag) external",
  "function isValidDenomination(address token, uint256 amount) external view returns (bool)",
];
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
const TOKENS = {
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  USDT: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
};

// ============================================================
// TAXA POR TIER (basis points)
// Tier 1: ate $500 equiv  -> 0.20% (20 bps)
// Tier 2: $500-$5000      -> 0.15% (15 bps)
// Tier 3: acima de $5000  -> 0.10% (10 bps)
// Para testnet usamos thresholds em ETH como proxy
// ============================================================
const TIER1_BPS = 20n; // 0.20%
const TIER2_BPS = 15n; // 0.15%
const TIER3_BPS = 10n; // 0.10%
const TIER2_THRESHOLD_ETH = ethers.parseEther("0.15");  // ~$500
const TIER3_THRESHOLD_ETH = ethers.parseEther("1.5");    // ~$5000
const TIER2_THRESHOLD_USDC = ethers.parseUnits("500", 6);
const TIER3_THRESHOLD_USDC = ethers.parseUnits("5000", 6);
const TIER2_THRESHOLD_USDT = ethers.parseUnits("500", 6);
const TIER3_THRESHOLD_USDT = ethers.parseUnits("5000", 6);

function getTaxaBps(token, valor) {
  let t2, t3;
  if (token === "ETH") { t2 = TIER2_THRESHOLD_ETH; t3 = TIER3_THRESHOLD_ETH; }
  else if (token === "USDC") { t2 = TIER2_THRESHOLD_USDC; t3 = TIER3_THRESHOLD_USDC; }
  else if (token === "USDT") { t2 = TIER2_THRESHOLD_USDT; t3 = TIER3_THRESHOLD_USDT; }
  else return TIER1_BPS;
  if (valor >= t3) return TIER3_BPS;
  if (valor >= t2) return TIER2_BPS;
  return TIER1_BPS;
}

function descontarTaxa(valorBruto, token) {
  const bps = getTaxaBps(token, valorBruto);
  const taxa = (valorBruto * bps) / 10000n;
  return { valorLiquido: valorBruto - taxa, taxa, bps };
}

const MIN_ETH  = ethers.parseEther(process.env.MIN_ETH  || "0.05");
const MIN_USDC = ethers.parseUnits(process.env.MIN_USDC || "5", 6);
const MIN_USDT = ethers.parseUnits(process.env.MIN_USDT || "5", 6);

function getMinimo(token) {
  if (token === "ETH")  return MIN_ETH;
  if (token === "USDC") return MIN_USDC;
  if (token === "USDT") return MIN_USDT;
  return 0n;
}

const masterWallet = new ethers.Wallet(process.env.CARTEIRA_PRIVADA, provider);
const entradasPendentes = new Map();
const fila = new Map();
let pipelineAtivo = false;

// ============================================================
// ANALYTICS — contadores em memoria (reseta no redeploy)
// ============================================================
const stats = {
  totalTxs: 0,
  totalTxsConcluidas: 0,
  volumeETH: 0n,
  volumeUSDC: 0n,
  volumeUSDT: 0n,
  receitaETH: 0n,
  receitaUSDC: 0n,
  receitaUSDT: 0n,
  dummiesEnviados: 0,
  iniciadoEm: Date.now(),
};

const ADMIN_KEY = process.env.ADMIN_KEY || "sf_admin_2026";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ============================================================
// DELAYS INTELIGENTES — cada split tem range diferente
// Variacoes maiores tornam correlacao temporal muito mais dificil
// ============================================================
function gerarDelayProfile() {
  // Cada split recebe um "perfil" de delay diferente
  const profiles = [
    { min: 20, max: 90 },   // rapido
    { min: 45, max: 150 },  // medio
    { min: 60, max: 180 },  // lento
    { min: 30, max: 120 },  // padrao
    { min: 80, max: 200 },  // muito lento
  ];
  return profiles[Math.floor(Math.random() * profiles.length)];
}

function delayAleatorio(profile) {
  const { min, max } = profile || { min: 30, max: 120 };
  // Distribuicao nao-uniforme: mais provavel perto do meio
  const r1 = Math.random();
  const r2 = Math.random();
  const avg = (r1 + r2) / 2; // triangular-ish distribution
  return (min + avg * (max - min)) * 1000;
}

function splitAleatorio(total, partes) {
  const vals = [];
  let restante = total;
  for (let i = 0; i < partes - 1; i++) {
    const min = restante / 5n;
    const max = restante / 2n;
    const rand = BigInt(Math.floor(Math.random() * Number(max - min)));
    vals.push(min + rand);
    restante -= min + rand;
  }
  vals.push(restante);
  return vals.sort(() => Math.random() - 0.5);
}

// Denominacoes fixas ETH (em wei) — devem bater com o contrato V7
const ETH_DENOMS = [
  ethers.parseEther("5"),
  ethers.parseEther("1"),
  ethers.parseEther("0.5"),
  ethers.parseEther("0.1"),
  ethers.parseEther("0.05"),
  ethers.parseEther("0.01"),
]; // ordem decrescente

// Denominacoes fixas USDC/USDT (em units com 6 decimais)
const STABLE_DENOMS = [
  ethers.parseUnits("1000", 6),
  ethers.parseUnits("500", 6),
  ethers.parseUnits("100", 6),
  ethers.parseUnits("50", 6),
  ethers.parseUnits("10", 6),
]; // ordem decrescente

function getDenoms(token) {
  if (token === "ETH") return ETH_DENOMS;
  return STABLE_DENOMS;
}

// Quebra valor em denominacoes fixas validas (greedy)
// Ex: 0.35 ETH -> [0.1, 0.1, 0.1, 0.05]
function splitEmDenominacoes(total, token) {
  const denoms = getDenoms(token);
  const result = [];
  let restante = total;
  for (const d of denoms) {
    while (restante >= d) {
      result.push(d);
      restante -= d;
    }
  }
  // Se sobrou resto que nao cabe em nenhuma denominacao,
  // adiciona a menor denominacao e o pipeline absorve a diferenca como gas
  if (result.length === 0 && total > 0n) {
    // Valor menor que menor denominacao — usa split aleatorio como fallback
    return null;
  }
  // Embaralhar ordem
  return result.sort(() => Math.random() - 0.5);
}

async function getGasPrice() { return (await provider.getFeeData()).gasPrice; }
async function estimarCustoGasETH() { return (await getGasPrice()) * 21000n; }
async function estimarCustoGasDeposit() { return (await getGasPrice()) * 120000n; }

async function financiarGas(destino) {
  const valor = (await estimarCustoGasETH()) * 4n;
  const tx = await masterWallet.sendTransaction({ to: destino, value: valor, gasLimit: 21000n });
  await tx.wait();
  return valor;
}

async function hopETH(deWallet, paraEndereco) {
  const gasPrice = await getGasPrice();
  const saldo = await provider.getBalance(deWallet.address);
  const enviar = saldo - gasPrice * 21000n;
  if (enviar <= 0n) return false;
  try {
    const tx = await deWallet.sendTransaction({ to: paraEndereco, value: enviar, gasLimit: 21000n, gasPrice });
    await tx.wait();
    console.log(`  hop: ${deWallet.address.slice(0,8)}... -> ${paraEndereco.slice(0,8)}...`);
    return true;
  } catch (e) { console.error(`  hopETH falhou: ${e.message}`); return false; }
}

async function depositarETHNoContrato(wallet, valorFixo, stealthAddress, ephemeralPubKey, viewTag, timelocked) {
  const gasPrice = await getGasPrice();
  const gasLimit = 150000n;
  const contrato = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
  try {
    let tx;
    if (timelocked) {
      tx = await contrato.depositETHTimelocked(stealthAddress, ephemeralPubKey, viewTag, { value: valorFixo, gasLimit, gasPrice });
    } else {
      tx = await contrato.depositETH(stealthAddress, ephemeralPubKey, viewTag, { value: valorFixo, gasLimit, gasPrice });
    }
    await tx.wait();
    console.log(`  depositETH${timelocked?"Timelocked":""}: ${ethers.formatEther(valorFixo)} ETH -> stealth ${stealthAddress.slice(0,10)}...`);
    return tx.hash;
  } catch (e) { console.error(`  depositETH falhou: ${e.message}`); return null; }
}

async function hopToken(deWallet, paraEndereco, tokenAddress, valor) {
  await financiarGas(deWallet.address);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, deWallet);
  try {
    const tx = await token.transfer(paraEndereco, valor);
    await tx.wait();
    return true;
  } catch (e) { console.error(`  hopToken falhou: ${e.message}`); return false; }
}

async function depositarTokenNoContrato(wallet, tokenAddress, valor, stealthAddress, ephemeralPubKey, viewTag, timelocked) {
  await financiarGas(wallet.address);
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const contratoContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
  try {
    const approveTx = await tokenContract.approve(CONTRACT_ADDRESS, valor);
    await approveTx.wait();
    const gasPrice = await getGasPrice();
    let tx;
    if (timelocked) {
      tx = await contratoContract.depositTokenTimelocked(tokenAddress, valor, stealthAddress, ephemeralPubKey, viewTag, { gasLimit: 180000n, gasPrice });
    } else {
      tx = await contratoContract.depositToken(tokenAddress, valor, stealthAddress, ephemeralPubKey, viewTag, { gasLimit: 180000n, gasPrice });
    }
    await tx.wait();
    return tx.hash;
  } catch (e) { console.error(`  depositToken falhou: ${e.message}`); return null; }
}

// ============================================================
// DUMMY TRANSACTIONS — mais inteligentes
// - Valores variados (nao sempre 0.00001)
// - Probabilidade maior (70% vs 50%)
// - Pode enviar 1-2 dummies de cada vez
// - Dummies antes e depois dos hops tambem
// ============================================================
async function enviarDummy() {
  if (pipelineAtivo) return;
  if (Math.random() > 0.7) return; // 70% chance de enviar (era 50%)
  try {
    // Numero de dummies: 1 ou 2
    const numDummies = Math.random() > 0.7 ? 2 : 1;
    for (let i = 0; i < numDummies; i++) {
      const efemero = ethers.Wallet.createRandom();
      const gasPrice = await getGasPrice();
      // Valor variado entre 0.000005 e 0.00005 ETH
      const baseVal = 5 + Math.floor(Math.random() * 45); // 5-50
      const valor = ethers.parseUnits(baseVal.toString(), 12); // 0.000005 - 0.00005 ETH
      await masterWallet.sendTransaction({ to: efemero.address, value: valor, gasLimit: 21000n, gasPrice });
      stats.dummiesEnviados++;
      console.log(`  ~ dummy #${stats.dummiesEnviados} -> ${efemero.address.slice(0,10)}... (${ethers.formatEther(valor)} ETH)`);
      if (numDummies === 2 && i === 0) {
        // Pequeno delay entre dummies
        await sleep(3000 + Math.random() * 8000);
      }
    }
  } catch {}
}

// Dummy periodico mesmo sem pipeline ativo — cria ruido de fundo
async function dummyPeriodico() {
  if (pipelineAtivo) return;
  if (Math.random() > 0.3) return; // 30% chance a cada ciclo
  await enviarDummy();
}

// ============================================================
// PIPELINE ETH — com delays inteligentes e dummies melhorados
// ============================================================
async function executarPipelineETH(txId, valorBruto, stealthAddress, ephemeralPubKey, viewTag, timelocked) {
  const tx = fila.get(txId);
  if (!tx) return;

  const { valorLiquido, taxa, bps } = descontarTaxa(valorBruto, "ETH");
  console.log(`  Taxa: ${ethers.formatEther(taxa)} ETH (${Number(bps)/100}%) | Liquido: ${ethers.formatEther(valorLiquido)} ETH`);

  // Analytics
  stats.volumeETH += valorBruto;
  stats.receitaETH += taxa;

  // Tenta quebrar em denominacoes fixas; fallback para split aleatorio
  let partes = splitEmDenominacoes(valorLiquido, "ETH");
  const usandoDenoms = partes !== null;
  if (!partes) {
    const numSplits = 2 + Math.floor(Math.random() * 2);
    partes = splitAleatorio(valorLiquido, numSplits);
  }

  const numHopsPerSplit = 2;
  tx.hopsTotal = partes.length * numHopsPerSplit;
  tx.hopsFeitos = 0;
  tx.splits = partes.length;
  tx.taxaBps = Number(bps);

  console.log(`\n Pipeline ETH [${txId}]: ${partes.length} splits (denoms: ${usandoDenoms})${timelocked ? " [TIMELOCKED]" : ""}`);

  const cadeias = partes.map(() =>
    Array.from({ length: numHopsPerSplit }, () => ethers.Wallet.createRandom().connect(provider))
  );

  // FASE 1: Financia em serie
  pipelineAtivo = true;
  const gasDeposit = await estimarCustoGasDeposit();
  const gasHops = (await estimarCustoGasETH()) * BigInt(numHopsPerSplit);
  const gasExtra = await estimarCustoGasETH();

  for (let i = 0; i < partes.length; i++) {
    const GAS_BUFFER = ethers.parseEther("0.000005"); // buffer fixo de gas
    const valorComGas = partes[i] + gasDeposit + gasHops + GAS_BUFFER;
    const txFund = await masterWallet.sendTransaction({ to: cadeias[i][0].address, value: valorComGas, gasLimit: 21000n });
    await txFund.wait();
    console.log(`  -> Funded E${i+1}[0]: ${cadeias[i][0].address.slice(0,10)}... (${ethers.formatEther(partes[i])} ETH)`);
  }
  pipelineAtivo = false;

  await enviarDummy();

  // FASE 2: Hops em paralelo com delays inteligentes
  const promessas = partes.map(async (valorParte, i) => {
    const cadeia = cadeias[i];
    const delayProfile = gerarDelayProfile();
    try {
      for (let h = 0; h < cadeia.length - 1; h++) {
        const delay = delayAleatorio(delayProfile);
        console.log(`  Split ${i+1} hop ${h+1}: aguardando ${Math.round(delay/1000)}s...`);
        await sleep(delay);
        await enviarDummy();
        const ok = await hopETH(cadeia[h], cadeia[h + 1].address);
        if (!ok) throw new Error(`Hop ${h} falhou`);
        tx.hopsFeitos++;
      }
      const delayFinal = delayAleatorio(delayProfile);
      await sleep(delayFinal);
      await enviarDummy();
      // Deposita o valor fixo da denominacao (nao o saldo todo da wallet)
      const depositHash = await depositarETHNoContrato(cadeia[cadeia.length - 1], valorParte, stealthAddress, ephemeralPubKey, viewTag, timelocked);
      tx.hopsFeitos++;
      if (!depositHash) throw new Error(`Deposito final falhou`);
      console.log(`  Split ${i+1} concluido`);
      return depositHash;
    } catch (e) {
      console.error(`  Split ${i} falhou: ${e.message} — fallback`);
      try {
        const c = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, masterWallet);
        const gasPrice = await getGasPrice();
        const txFb = timelocked
          ? await c.depositETHTimelocked(stealthAddress, ephemeralPubKey, viewTag, { value: valorParte, gasLimit: 150000n, gasPrice })
          : await c.depositETH(stealthAddress, ephemeralPubKey, viewTag, { value: valorParte, gasLimit: 150000n, gasPrice });
        await txFb.wait();
        return txFb.hash;
      } catch (e2) { return null; }
    }
  });

  const resultados = await Promise.allSettled(promessas);

  // Dummy pos-pipeline — ruido depois dos depositos
  await enviarDummy();

  tx.concluido = true;
  tx.depositHashes = resultados.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  stats.totalTxsConcluidas++;
  console.log(`\n Pipeline ETH [${txId}] concluido — ${tx.depositHashes.length}/${partes.length} splits\n`);
}

// ============================================================
// PIPELINE TOKEN — com delays inteligentes
// ============================================================
async function executarPipelineToken(txId, tokenAddress, valorBruto, tokenSymbol, stealthAddress, ephemeralPubKey, viewTag, timelocked) {
  const tx = fila.get(txId);
  if (!tx) return;

  const { valorLiquido, taxa, bps } = descontarTaxa(valorBruto, tokenSymbol);
  console.log(`  Taxa coletada: ${taxa.toString()} units (${Number(bps)/100}%)`);

  if (tokenSymbol === "USDC") { stats.volumeUSDC += valorBruto; stats.receitaUSDC += taxa; }
  if (tokenSymbol === "USDT") { stats.volumeUSDT += valorBruto; stats.receitaUSDT += taxa; }

  // Tenta denominacoes fixas; fallback para split aleatorio
  let partes = splitEmDenominacoes(valorLiquido, tokenSymbol);
  if (!partes) {
    partes = splitAleatorio(valorLiquido, 2);
  }

  const numHopsPerSplit = 2;
  tx.hopsTotal = partes.length * numHopsPerSplit;
  tx.hopsFeitos = 0;
  tx.splits = partes.length;
  tx.taxaBps = Number(bps);

  console.log(`\n Pipeline Token [${txId}]: ${partes.length} splits${timelocked ? " [TIMELOCKED]" : ""}`);

  const depositHashes = [];
  for (let i = 0; i < partes.length; i++) {
    const valorParte = partes[i];
    const delayProfile = gerarDelayProfile();
    try {
      const cadeia = Array.from({ length: numHopsPerSplit }, () => ethers.Wallet.createRandom().connect(provider));
      await hopToken(masterWallet, cadeia[0].address, tokenAddress, valorParte);
      console.log(`  -> Funded E${i+1}[0] com tokens`);

      for (let h = 0; h < cadeia.length - 1; h++) {
        const delay = delayAleatorio(delayProfile);
        console.log(`  Split ${i+1} hop ${h+1}: aguardando ${Math.round(delay/1000)}s...`);
        await sleep(delay);
        await enviarDummy();
        const saldo = await new ethers.Contract(tokenAddress, ERC20_ABI, provider).balanceOf(cadeia[h].address);
        const ok = await hopToken(cadeia[h], cadeia[h+1].address, tokenAddress, saldo);
        if (!ok) throw new Error(`Token hop ${h} falhou`);
        tx.hopsFeitos++;
      }

      const delayFinal = delayAleatorio(delayProfile);
      await sleep(delayFinal);
      await enviarDummy();
      const hash = await depositarTokenNoContrato(cadeia[cadeia.length-1], tokenAddress, valorParte, stealthAddress, ephemeralPubKey, viewTag, timelocked);
      tx.hopsFeitos++;
      if (hash) depositHashes.push(hash);
      console.log(`  Split ${i+1} token concluido`);
    } catch (e) {
      console.error(`  Split token ${i} falhou: ${e.message} — fallback`);
      try {
        const hash = await depositarTokenNoContrato(masterWallet, tokenAddress, valorParte, stealthAddress, ephemeralPubKey, viewTag, timelocked);
        if (hash) depositHashes.push(hash);
      } catch {}
    }
  }

  tx.concluido = true;
  tx.depositHashes = depositHashes;
  stats.totalTxsConcluidas++;
  console.log(`\n Pipeline Token [${txId}] concluido\n`);
}

// ============================================================
// MONITORAR ENTRADAS — a cada 10s
// ============================================================
async function monitorarEntradas() {
  for (const [endereco, entrada] of entradasPendentes.entries()) {
    if (Date.now() - entrada.criadoEm > 30 * 60 * 1000) {
      console.log(`Entrada expirada: ${endereco.slice(0,10)}...`);
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
      if (valorRecebido < getMinimo(entrada.token)) continue;

      console.log(`\n Entrada detectada: ${endereco.slice(0,10)}... recebeu ${entrada.token === 'ETH' ? ethers.formatEther(valorRecebido) : valorRecebido.toString()} ${entrada.token}`);
      entradasPendentes.delete(endereco);

      stats.totalTxs++;

      const id = `sf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      fila.set(id, {
        id,
        entradaAddress: endereco,
        token: entrada.token,
        valorTotal: valorRecebido.toString(),
        stealthAddress: entrada.stealthAddress,
        ephemeralPubKey: entrada.ephemeralPubKey,
        viewTag: entrada.viewTag,
        hopsFeitos: 0,
        hopsTotal: 4,
        splits: 2,
        taxaBps: 20,
        concluido: false,
        criadoEm: Date.now(),
        depositHashes: [],
      });

      if (entrada.token === "ETH") {
  executarPipelineETH(id, valorRecebido, entrada.stealthAddress, entrada.ephemeralPubKey, entrada.viewTag, entrada.timelocked || false)
    .catch(e => console.error(`Pipeline ETH erro:`, e.message));
    
      } else {
        const tokenAddr = TOKENS[entrada.token].address;
        executarPipelineToken(id, tokenAddr, valorRecebido, entrada.token, entrada.stealthAddress, entrada.ephemeralPubKey, entrada.viewTag, entrada.timelocked || false)
          .catch(e => console.error(`Pipeline Token erro:`, e.message));
      }
    } catch (e) { console.error(`Erro monitorando ${endereco.slice(0,10)}...: ${e.message}`); }
  }
}

setInterval(monitorarEntradas, 10000);

// Dummy periodico a cada 2-5 minutos para criar ruido de fundo
setInterval(dummyPeriodico, 120000 + Math.random() * 180000);

// Limpeza de pipelines antigos (mais de 2 horas) a cada 30 minutos
setInterval(() => {
  const agora = Date.now();
  for (const [id, tx] of fila.entries()) {
    if (tx.concluido && agora - tx.criadoEm > 2 * 60 * 60 * 1000) {
      fila.delete(id);
    }
  }
}, 30 * 60 * 1000);

// ============================================================
// ENDPOINTS
// ============================================================

// GET /entrada — gera endereco de entrada descartavel
app.get("/entrada", (req, res) => {
  try {
    const { token, stealthAddress, ephemeralPubKey, viewTag, timelocked } = req.query;
    if (!token || !stealthAddress || !ephemeralPubKey || viewTag === undefined)
      return res.status(400).json({ erro: "Parametros incompletos" });
    const minimo = getMinimo(token);
    const wallet = ethers.Wallet.createRandom().connect(provider);
    entradasPendentes.set(wallet.address, {
      wallet, token, stealthAddress, ephemeralPubKey,
      viewTag: parseInt(viewTag), timelocked: timelocked === "true",
      criadoEm: Date.now(), resolveId: null,
    });
    console.log(`Nova entrada gerada: ${wallet.address.slice(0,10)}... [${token}]${timelocked === "true" ? " [TIMELOCKED]" : ""}`);
    res.json({
      entradaAddress: wallet.address,
      token,
      minimoWei: minimo.toString(),
      minimoFormatado: token === "ETH" ? ethers.formatEther(minimo) + " ETH" : ethers.formatUnits(minimo, 6) + " " + token,
      expiresIn: 1800,
    });
  } catch (e) { console.error(e); res.status(500).json({ erro: e.message }); }
});

// GET /aguardar/:endereco — frontend faz polling para saber se entrada foi processada
app.get("/aguardar/:endereco", (req, res) => {
  const endereco = req.params.endereco;
  if (entradasPendentes.has(endereco)) return res.json({ recebido: false });
  for (const [id, tx] of [...fila.entries()].reverse()) {
    if (tx.entradaAddress === endereco) return res.json({ recebido: true, id });
  }
  return res.json({ recebido: false });
});

// GET /status/:id — status do pipeline (com detalhes extras para timeline visual)
app.get("/status/:id", (req, res) => {
  const tx = fila.get(req.params.id);
  if (!tx) return res.status(404).json({ erro: "Nao encontrado" });
  const hopsFeitos = tx.hopsFeitos || 0;
  const hopsTotal = tx.hopsTotal || 4;
  const hopsRestantes = Math.max(0, hopsTotal - hopsFeitos);
  res.json({
    concluido: tx.concluido || false,
    hopsFeitos,
    hopsTotal,
    minutosRestantes: Math.ceil(hopsRestantes * 2.5), // ajustado para delays maiores
    splits: tx.splits || 2,
    taxaBps: tx.taxaBps || 20,
    depositHashes: tx.depositHashes || [],
  });
});

// GET /minimos — valores minimos por token
app.get("/minimos", (req, res) => {
  res.json({
    ETH:  { wei: MIN_ETH.toString(),  formatado: ethers.formatEther(MIN_ETH) + " ETH" },
    USDC: { wei: MIN_USDC.toString(), formatado: ethers.formatUnits(MIN_USDC, 6) + " USDC" },
    USDT: { wei: MIN_USDT.toString(), formatado: ethers.formatUnits(MIN_USDT, 6) + " USDT" },
  });
});

// GET /taxas — retorna tiers de taxa para o frontend exibir
app.get("/taxas", (req, res) => {
  res.json({
    tiers: [
      { label: "Standard", maxLabel: "ate ~$500", bps: 20, percent: "0.20%" },
      { label: "Volume",   maxLabel: "$500 - $5,000", bps: 15, percent: "0.15%" },
      { label: "Premium",  maxLabel: "acima de $5,000", bps: 10, percent: "0.10%" },
    ],
  });
});

// GET /health — status do backend
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    filaSize: fila.size,
    entradasPendentes: entradasPendentes.size,
    pipelineAtivo,
    uptime: Math.floor((Date.now() - stats.iniciadoEm) / 1000),
  });
});

// ============================================================
// ADMIN DASHBOARD — protegido por chave
// GET /admin/stats?key=sf_admin_2026
// ============================================================
app.get("/admin/stats", (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).json({ erro: "Acesso negado" });
  }

  const uptimeMs = Date.now() - stats.iniciadoEm;
  const uptimeHoras = (uptimeMs / (1000 * 60 * 60)).toFixed(1);

  // Pipelines ativos
  let pipelinesAtivos = 0;
  let pipelinesConcluidos = 0;
  for (const [, tx] of fila) {
    if (tx.concluido) pipelinesConcluidos++;
    else pipelinesAtivos++;
  }

  res.json({
    periodo: {
      iniciadoEm: new Date(stats.iniciadoEm).toISOString(),
      uptimeHoras: parseFloat(uptimeHoras),
    },
    transacoes: {
      total: stats.totalTxs,
      concluidas: stats.totalTxsConcluidas,
      ativas: pipelinesAtivos,
      naFila: fila.size,
    },
    volume: {
      ETH: ethers.formatEther(stats.volumeETH) + " ETH",
      USDC: ethers.formatUnits(stats.volumeUSDC, 6) + " USDC",
      USDT: ethers.formatUnits(stats.volumeUSDT, 6) + " USDT",
    },
    receita: {
      ETH: ethers.formatEther(stats.receitaETH) + " ETH",
      USDC: ethers.formatUnits(stats.receitaUSDC, 6) + " USDC",
      USDT: ethers.formatUnits(stats.receitaUSDT, 6) + " USDT",
    },
    taxas: {
      tier1: "0.20% (ate ~$500)",
      tier2: "0.15% ($500-$5000)",
      tier3: "0.10% (acima $5000)",
    },
    privacidade: {
      dummiesEnviados: stats.dummiesEnviados,
    },
    infra: {
      masterWallet: masterWallet.address,
      entradasPendentes: entradasPendentes.size,
      pipelineAtivo,
    },
  });
});

const PORT = process.env.PORT || 3001;

// Dummy periodico a cada 2-5 minutos para criar ruido de fundo

app.listen(PORT, () => {
  console.log(`SilentFlow backend v7 (Base Mainnet) — porta ${PORT}`);
  console.log(`Master wallet: ${masterWallet.address}`);
  console.log(`Contrato V7: ${CONTRACT_ADDRESS}`);
  console.log(`Taxas: 0.20% (standard) / 0.15% (volume) / 0.10% (premium)`);
  console.log(`Minimos: ${ethers.formatEther(MIN_ETH)} ETH / ${ethers.formatUnits(MIN_USDC,6)} USDC / ${ethers.formatUnits(MIN_USDT,6)} USDT`);
});
