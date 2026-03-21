const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_URL);

const CONTRACT_ADDRESS = "0x9ce1b8a2344BB1891A6Ed9b2aBb782fb1B8C18E9";
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
  USDC: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 },
  USDT: { address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0", decimals: 6 },
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

const MIN_ETH  = ethers.parseEther(process.env.MIN_ETH  || "0.005");
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
    const valorComGas = partes[i] + gasDeposit + gasHops + gasExtra;
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
        const gasPrice = await getGasPrice();
        const enviar = valorRecebido - gasPrice * 21000n;
        if (enviar > 0n) {
          const txMove = await entrada.wallet.sendTransaction({ to: masterWallet.address, value: enviar, gasLimit: 21000n, gasPrice });
          await txMove.wait();
          console.log(`  -> ETH consolidado na master: ${ethers.formatEther(enviar)} ETH`);
        }
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

// ============================================================
// ZK MODULE — Contrato V8 + Merkle Tree Tracking
// ============================================================
const ZK_CONTRACT_ADDRESS = "0xB2c88ff42e75879feE4A680b3577BA57bed8Af8e"; // sera atualizado apos redeploy
const POSEIDON_ADDRESS = "0x72F721D9D5f91353B505207C63B56cF3d9447edB"; // iden3 Poseidon T3 na Sepolia
const ZK_CONTRACT_ABI = [
  "function depositETH(uint256 commitment) external payable",
  "function depositToken(address token, uint256 amount, uint256 commitment) external",
  "function withdraw(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256 root, uint256 nullifierHash, address payable recipient, address token, uint256 denomination, uint256 relayerFee) external",
  "function getLastRoot() external view returns (uint256)",
  "function getTreeSize() external view returns (uint256)",
  "function isSpent(uint256 nullifierHash) external view returns (bool)",
  "function isCommitted(uint256 commitment) external view returns (bool)",
  "function nextIndex() external view returns (uint256)",
  "function filledSubtrees(uint256) external view returns (uint256)",
  "function isKnownRoot(uint256) external view returns (bool)",
  "function hashLeftRight(uint256, uint256) external view returns (uint256)",
  "function getZeroValue(uint256) external view returns (uint256)",
  "event Deposit(uint256 indexed commitment, uint256 leafIndex, uint256 timestamp, address token, uint256 denomination)",
];
const POSEIDON_ABI = [
  "function poseidon(uint256[2] calldata) external pure returns (uint256)",
];

const MERKLE_LEVELS = 20;
const FIELD_SIZE = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// Cache dos zero values (computados com Poseidon pelo contrato)
let zeroValues = null;

async function loadZeroValues() {
  if (zeroValues) return;
  try {
    const zkContract = new ethers.Contract(ZK_CONTRACT_ADDRESS, ZK_CONTRACT_ABI, provider);
    zeroValues = [];
    for (let i = 0; i <= MERKLE_LEVELS; i++) {
      const z = await zkContract.getZeroValue(i);
      zeroValues.push(BigInt(z.toString()));
    }
    console.log(`Zero values loaded: ${zeroValues.length} levels`);
  } catch (e) {
    console.error(`Failed to load zero values: ${e.message}`);
    // Fallback: zero value 0 for all levels
    zeroValues = new Array(MERKLE_LEVELS + 1).fill(0n);
  }
}

// Hash via Poseidon on-chain
const poseidonContract = new ethers.Contract(POSEIDON_ADDRESS, POSEIDON_ABI, provider);

async function hashLeftRightPoseidon(left, right) {
  const result = await poseidonContract.poseidon([left.toString(), right.toString()]);
  return BigInt(result.toString());
}

// Merkle tree local mirror
let localTree = {
  leaves: [],
  layers: [],
  initialized: false,
};

// Build tree using cached Poseidon hashes from on-chain
// Since calling Poseidon on-chain for every hash is slow,
// we read the tree state from the contract events and
// compute the root using the contract's hashLeftRight
async function buildMerkleTreeOnChain(leaves) {
  await loadZeroValues();
  const layers = [leaves.map(l => BigInt(l))];
  let currentLayer = layers[0];

  for (let level = 0; level < MERKLE_LEVELS; level++) {
    const nextLayer = [];
    for (let i = 0; i < Math.ceil(currentLayer.length / 2); i++) {
      const left = currentLayer[i * 2];
      const right = i * 2 + 1 < currentLayer.length ? currentLayer[i * 2 + 1] : zeroValues[level];
      // Use on-chain Poseidon
      const hash = await hashLeftRightPoseidon(left, right);
      nextLayer.push(hash);
    }
    if (nextLayer.length === 0) {
      nextLayer.push(await hashLeftRightPoseidon(zeroValues[level], zeroValues[level]));
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }
  return layers;
}

function getMerklePath(layers, leafIndex) {
  if (!zeroValues) return { pathElements: [], pathIndices: [] };
  const pathElements = [];
  const pathIndices = [];
  let currentIndex = leafIndex;

  for (let level = 0; level < MERKLE_LEVELS; level++) {
    const layer = layers[level] || [];
    const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
    const sibling = siblingIndex >= 0 && siblingIndex < layer.length
      ? layer[siblingIndex]
      : zeroValues[level];

    pathElements.push(sibling.toString());
    pathIndices.push(currentIndex % 2);
    currentIndex = Math.floor(currentIndex / 2);
  }

  return { pathElements, pathIndices };
}

// Sync Merkle tree from chain events
// Alchemy free: max 10 blocos por getLogs request
// Estrategia: guardar o ultimo bloco sincronizado para nao re-escanear tudo
let lastSyncedBlock = 0;
const ZK_DEPLOY_BLOCK = 0; // sera descoberto automaticamente

async function syncMerkleTree() {
  try {
    const zkContract = new ethers.Contract(ZK_CONTRACT_ADDRESS, ZK_CONTRACT_ABI, provider);
    const treeSize = Number(await zkContract.nextIndex());

    if (treeSize === localTree.leaves.length && localTree.initialized) return;
    if (treeSize === 0) { localTree.initialized = true; return; }

    console.log(`Merkle sync: on-chain=${treeSize}, local=${localTree.leaves.length}`);

    const filter = zkContract.filters.Deposit();
    const currentBlock = await provider.getBlockNumber();
    const CHUNK = 9; // Alchemy free limit

    // Se primeira vez, buscar desde o bloco do deploy do contrato V8
    let fromBlock;
    if (lastSyncedBlock > 0) {
      fromBlock = lastSyncedBlock + 1;
    } else {
      // Bloco do deploy do contrato V8 Poseidon na Sepolia
      fromBlock = 10478300;
    }

    if (fromBlock > currentBlock) return;

    const events = [];
    for (let start = fromBlock; start <= currentBlock; start += CHUNK + 1) {
      const end = Math.min(start + CHUNK, currentBlock);
      try {
        const chunk = await zkContract.queryFilter(filter, start, end);
        events.push(...chunk);
      } catch (e) {
        // Se falhar, tenta com range menor
        try {
          for (let s = start; s <= end; s++) {
            const single = await zkContract.queryFilter(filter, s, s);
            events.push(...single);
          }
        } catch {}
      }
    }

    lastSyncedBlock = currentBlock;

    if (events.length > 0 || !localTree.initialized) {
      // Se temos novos eventos, adicionar aos leaves existentes
      const newLeaves = events.map(e => ({
        commitment: e.args[0].toString(),
        leafIndex: Number(e.args[1]),
      }));

      // Merge com existentes (evitar duplicatas)
      const existingCommitments = new Set(localTree.leaves);
      for (const nl of newLeaves) {
        if (!existingCommitments.has(nl.commitment)) {
          localTree.leaves.push(nl.commitment);
        }
      }

      // Rebuild tree se mudou
      if (localTree.leaves.length > 0) {
        console.log(`Building Merkle tree with Poseidon (${localTree.leaves.length} leaves)...`);
        localTree.layers = await buildMerkleTreeOnChain(localTree.leaves);
        console.log(`Merkle tree built. Root: ${localTree.layers[MERKLE_LEVELS] ? localTree.layers[MERKLE_LEVELS][0] : "empty"}`);
      }
      localTree.initialized = true;
      console.log(`Merkle tree synced: ${localTree.leaves.length} leaves`);
    }
  } catch (e) {
    console.error(`Merkle tree sync error: ${e.message}`);
  }
}

// Sync every 30 seconds
setInterval(syncMerkleTree, 30000);
syncMerkleTree(); // initial sync

// ============================================================
// ZK ENDPOINTS
// ============================================================

// GET /zk/info — info do contrato ZK
app.get("/zk/info", async (req, res) => {
  try {
    const zkContract = new ethers.Contract(ZK_CONTRACT_ADDRESS, ZK_CONTRACT_ABI, provider);
    const treeSize = Number(await zkContract.nextIndex());
    const root = (await zkContract.getLastRoot()).toString();
    res.json({
      contract: ZK_CONTRACT_ADDRESS,
      treeSize,
      root,
      localTreeSize: localTree.leaves.length,
      merkleDepth: MERKLE_LEVELS,
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// GET /zk/merkle-path/:leafIndex — retorna path elements para gerar ZK proof
app.get("/zk/merkle-path/:leafIndex", async (req, res) => {
  try {
    await syncMerkleTree(); // ensure fresh
    const leafIndex = parseInt(req.params.leafIndex);
    if (leafIndex < 0 || leafIndex >= localTree.leaves.length) {
      return res.status(404).json({ erro: "Leaf index out of range" });
    }
    const { pathElements, pathIndices } = getMerklePath(localTree.layers, leafIndex);
    const root = localTree.layers[MERKLE_LEVELS]
      ? localTree.layers[MERKLE_LEVELS][0].toString()
      : "0";

    res.json({ leafIndex, root, pathElements, pathIndices });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// GET /zk/deposits — usa dados da sync local
app.get("/zk/deposits", async (req, res) => {
  try {
    await syncMerkleTree();
    res.json({
      deposits: localTree.leaves.map((commitment, idx) => ({
        commitment,
        leafIndex: idx,
      })),
      treeSize: localTree.leaves.length,
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// GET /zk/is-spent/:nullifierHash — verifica se nullifier ja foi usado
app.get("/zk/is-spent/:nullifierHash", async (req, res) => {
  try {
    const zkContract = new ethers.Contract(ZK_CONTRACT_ADDRESS, ZK_CONTRACT_ABI, provider);
    const spent = await zkContract.isSpent(req.params.nullifierHash);
    res.json({ nullifierHash: req.params.nullifierHash, spent });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.listen(PORT, () => {
  console.log(`SilentFlow backend v6 (V7 stealth + V8 ZK) — porta ${PORT}`);
  console.log(`Master wallet: ${masterWallet.address}`);
  console.log(`V7 Stealth: ${CONTRACT_ADDRESS}`);
  console.log(`V8 ZK: ${ZK_CONTRACT_ADDRESS}`);
  console.log(`Taxas: 0.20% (standard) / 0.15% (volume) / 0.10% (premium)`);
});
