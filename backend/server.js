require('dotenv').config();
const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// REDES
// ============================================================
const REDE_ATUAL = process.env.REDE || "base";

const REDES = {
  base: {
    provider: new ethers.JsonRpcProvider(process.env.ALCHEMY_URL),
    contractAddress: "0x99f4a6Deb7643a1DDa10115BFE3c7a4D9C4Ef09B",
    tokens: {
      USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      USDT: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
    },
  },
  polygon: {
    provider: new ethers.JsonRpcProvider(process.env.ALCHEMY_URL),
    contractAddress: "0x074c000416A4725EDA5F53EE7b690f82f250847B",
    tokens: {
      USDC: { address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6 },
      USDT: { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
    },
  },
  bsc: {
    provider: new ethers.JsonRpcProvider(process.env.ALCHEMY_URL),
    contractAddress: "0x3d2E4d11Be4B2c1747eb0ABDC7f3118CA33d59c6",
    tokens: {
      USDC: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
      USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    },
  },
};

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

// Atalhos para compatibilidade (usa base como padrão)
const provider = REDES[REDE_ATUAL].provider;
const CONTRACT_ADDRESS = REDES[REDE_ATUAL].contractAddress;
const TOKENS = REDES[REDE_ATUAL].tokens;

function getRedeConfig(rede) {
  return REDES[rede] || REDES.base;
}

// ============================================================
// TAXA POR TIER (basis points)
// ============================================================
const TIER1_BPS = 50n; // 0.50%
const TIER2_BPS = 35n; // 0.35%
const TIER3_BPS = 20n; // 0.20%
const TIER2_THRESHOLD_ETH  = ethers.parseEther("0.15");
const TIER3_THRESHOLD_ETH  = ethers.parseEther("1.5");
const TIER2_THRESHOLD_USDC = ethers.parseUnits("500", 6);
const TIER3_THRESHOLD_USDC = ethers.parseUnits("5000", 6);
const TIER2_THRESHOLD_USDT = ethers.parseUnits("500", 6);
const TIER3_THRESHOLD_USDT = ethers.parseUnits("5000", 6);

function getTaxaBps(token, valor) {
  let t2, t3;
  if (token === "ETH")       { t2 = TIER2_THRESHOLD_ETH;  t3 = TIER3_THRESHOLD_ETH; }
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
const masterWallets = {
  base:    new ethers.Wallet(process.env.CARTEIRA_PRIVADA, REDES.base.provider),
  polygon: new ethers.Wallet(process.env.CARTEIRA_PRIVADA, REDES.polygon.provider),
  bsc:     new ethers.Wallet(process.env.CARTEIRA_PRIVADA, REDES.bsc.provider),
};

const entradasPendentes = new Map();
const fila = new Map();
let pipelineAtivo = false;

// ============================================================
// ANALYTICS
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
// DELAYS INTELIGENTES
// ============================================================
function gerarDelayProfile() {
  const profiles = [
    { min: 20, max: 90 },
    { min: 45, max: 150 },
    { min: 60, max: 180 },
    { min: 30, max: 120 },
    { min: 80, max: 200 },
  ];
  return profiles[Math.floor(Math.random() * profiles.length)];
}

function delayAleatorio(profile) {
  const { min, max } = profile || { min: 30, max: 120 };
  const r1 = Math.random();
  const r2 = Math.random();
  const avg = (r1 + r2) / 2;
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

const ETH_DENOMS = [
  ethers.parseEther("5"),
  ethers.parseEther("1"),
  ethers.parseEther("0.5"),
  ethers.parseEther("0.1"),
  ethers.parseEther("0.05"),
  ethers.parseEther("0.01"),
];

const STABLE_DENOMS = [
  ethers.parseUnits("1000", 6),
  ethers.parseUnits("500", 6),
  ethers.parseUnits("100", 6),
  ethers.parseUnits("50", 6),
  ethers.parseUnits("10", 6),
];

function getDenoms(token) {
  if (token === "ETH") return ETH_DENOMS;
  return STABLE_DENOMS;
}

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
  if (result.length === 0 && total > 0n) return null;
  return result.sort(() => Math.random() - 0.5);
}

// ============================================================
// GAS — ciente da rede
// ============================================================
async function getGasPrice(rede = "base") {
  return (await getRedeConfig(rede).provider.getFeeData()).gasPrice;
}
async function estimarCustoGasETH(rede = "base") { return (await getGasPrice(rede)) * 21000n; }
async function estimarCustoGasDeposit(rede = "base") { return (await getGasPrice(rede)) * 120000n; }

async function financiarGas(destino, rede = "base") {
  const mw = masterWallets[rede] || masterWallet;
  const feeData = await getRedeConfig(rede).provider.getFeeData();
  const valor = feeData.gasPrice * 21000n * 20n;
  const tx = await mw.sendTransaction({ 
    to: destino, 
    value: valor,
    gasLimit: 21000n,
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });
  console.log(`  Gas tx: ${tx.hash.slice(0,10)}... valor: ${ethers.formatEther(valor)} POL`);
  await tx.wait();
  console.log(`  Gas confirmado!`);
  return valor;
}

async function hopETH(deWallet, paraEndereco, rede = "base") {
  const redeProvider = getRedeConfig(rede).provider;
  const gasPrice = await getGasPrice(rede);
  const saldo = await redeProvider.getBalance(deWallet.address);
  const gasFixed = ethers.parseUnits("0.1", "gwei") * 21000n;
  const enviar = saldo - gasFixed;
  if (enviar <= 0n) return false;
  try {
    const tx = await deWallet.sendTransaction({ to: paraEndereco, value: enviar, gasLimit: 21000n, gasPrice });
    await tx.wait();
    console.log(`  hop: ${deWallet.address.slice(0,8)}... -> ${paraEndereco.slice(0,8)}...`);
    return true;
  } catch (e) { console.error(`  hopETH falhou: ${e.message}`); return false; }
}

async function depositarETHNoContrato(wallet, valorFixo, stealthAddress, ephemeralPubKey, viewTag, timelocked, rede = "base") {
  const redeCfg = getRedeConfig(rede);
  const gasPrice = await getGasPrice(rede);
  const gasLimit = 150000n;
  const contrato = new ethers.Contract(redeCfg.contractAddress, CONTRACT_ABI, wallet);
  try {
    let tx;
    if (timelocked) {
      tx = await contrato.depositETHTimelocked(stealthAddress, ephemeralPubKey, viewTag, { value: valorFixo, gasLimit, gasPrice });
    } else {
      tx = await contrato.depositETH(stealthAddress, ephemeralPubKey, viewTag, { value: valorFixo, gasLimit, gasPrice });
    }
    await tx.wait();
    console.log(`  depositETH${timelocked?"Timelocked":""}: ${ethers.formatEther(valorFixo)} ETH -> stealth ${stealthAddress.slice(0,10)}... [${rede}]`);
    return tx.hash;
  } catch (e) { console.error(`  depositETH falhou: ${e.message}`); return null; }
}

async function hopToken(deWallet, paraEndereco, tokenAddress, valor, rede = "base") {
  await financiarGas(deWallet.address, rede);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, deWallet);
  try {
    const tx = await token.transfer(paraEndereco, valor);
    await tx.wait();
    return true;
  } catch (e) { console.error(`  hopToken falhou: ${e.message}`); return false; }
}

async function depositarTokenNoContrato(wallet, tokenAddress, valor, stealthAddress, ephemeralPubKey, viewTag, timelocked, rede = "base") {
  const redeCfg = getRedeConfig(rede);
  await financiarGas(wallet.address, rede);
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const contratoContract = new ethers.Contract(redeCfg.contractAddress, CONTRACT_ABI, wallet);
  try {
    const approveTx = await tokenContract.approve(redeCfg.contractAddress, valor);
    await approveTx.wait();
    const gasPrice = await getGasPrice(rede);
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
// DUMMY TRANSACTIONS
// ============================================================
async function enviarDummy() {
  return; // PAUSADO — reativar no lancamento
  if (pipelineAtivo) return;
  if (Math.random() > 0.7) return;
  try {
    const numDummies = Math.random() > 0.7 ? 2 : 1;
    for (let i = 0; i < numDummies; i++) {
      const efemero = ethers.Wallet.createRandom();
      const gasPrice = await getGasPrice();
      const baseVal = 5 + Math.floor(Math.random() * 45);
      const valor = ethers.parseUnits(baseVal.toString(), 12);
      await masterWallet.sendTransaction({ to: efemero.address, value: valor, gasLimit: 21000n, gasPrice });
      stats.dummiesEnviados++;
      console.log(`  ~ dummy #${stats.dummiesEnviados} -> ${efemero.address.slice(0,10)}... (${ethers.formatEther(valor)} ETH)`);
      if (numDummies === 2 && i === 0) await sleep(3000 + Math.random() * 8000);
    }
  } catch {}
}

async function dummyPeriodico() {
  return; // PAUSADO
  if (pipelineAtivo) return;
  if (Math.random() > 0.3) return;
  await enviarDummy();
}

// ============================================================
// PIPELINE ETH
// ============================================================
async function executarPipelineETH(txId, valorBruto, stealthAddress, ephemeralPubKey, viewTag, timelocked, rede = "base") {
  const tx = fila.get(txId);
  if (!tx) return;

  const redeCfg = getRedeConfig(rede);
  const redeProvider = redeCfg.provider;
  const mw = masterWallets[rede] || masterWallet;

  const { valorLiquido, taxa, bps } = descontarTaxa(valorBruto, "ETH");
  console.log(`  Taxa: ${ethers.formatEther(taxa)} ETH (${Number(bps)/100}%) | Liquido: ${ethers.formatEther(valorLiquido)} ETH [${rede}]`);

  stats.volumeETH += valorBruto;
  stats.receitaETH += taxa;

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

  console.log(`\n Pipeline ETH [${txId}] [${rede}]: ${partes.length} splits (denoms: ${usandoDenoms})${timelocked ? " [TIMELOCKED]" : ""}`);

  const cadeias = partes.map(() =>
    Array.from({ length: numHopsPerSplit }, () => ethers.Wallet.createRandom().connect(redeProvider))
  );

  // FASE 1: Financia em serie
  pipelineAtivo = true;
  for (let i = 0; i < partes.length; i++) {
    const GAS_BUFFER = ethers.parseEther("0.00002");
    const valorComGas = partes[i] + GAS_BUFFER;
    const txFund = await mw.sendTransaction({ to: cadeias[i][0].address, value: valorComGas, gasLimit: 21000n });
    await txFund.wait();
    console.log(`  -> Funded E${i+1}[0]: ${cadeias[i][0].address.slice(0,10)}... (${ethers.formatEther(partes[i])} ETH)`);
  }
  pipelineAtivo = false;

  await enviarDummy();

  // FASE 2: Hops em paralelo
  const promessas = partes.map(async (valorParte, i) => {
    const cadeia = cadeias[i];
    const delayProfile = gerarDelayProfile();
    try {
      for (let h = 0; h < cadeia.length - 1; h++) {
        const delay = delayAleatorio(delayProfile);
        console.log(`  Split ${i+1} hop ${h+1}: aguardando ${Math.round(delay/1000)}s...`);
        await sleep(delay);
        await enviarDummy();
        const ok = await hopETH(cadeia[h], cadeia[h + 1].address, rede);
        if (!ok) throw new Error(`Hop ${h} falhou`);
        tx.hopsFeitos++;
      }
      const delayFinal = delayAleatorio(delayProfile);
      await sleep(delayFinal);
      await enviarDummy();
      const depositHash = await depositarETHNoContrato(cadeia[cadeia.length - 1], valorParte, stealthAddress, ephemeralPubKey, viewTag, timelocked, rede);
      tx.hopsFeitos++;
      if (!depositHash) throw new Error(`Deposito final falhou`);
      console.log(`  Split ${i+1} concluido`);
      return depositHash;
    } catch (e) {
      console.error(`  Split ${i} falhou: ${e.message} — fallback`);
      try {
        const c = new ethers.Contract(redeCfg.contractAddress, CONTRACT_ABI, mw);
        const gasPrice = await getGasPrice(rede);
        const txFb = timelocked
          ? await c.depositETHTimelocked(stealthAddress, ephemeralPubKey, viewTag, { value: valorParte, gasLimit: 150000n, gasPrice })
          : await c.depositETH(stealthAddress, ephemeralPubKey, viewTag, { value: valorParte, gasLimit: 150000n, gasPrice });
        await txFb.wait();
        return txFb.hash;
      } catch (e2) { console.error(`  Fallback falhou: ${e2.message}`); return null; }
    }
  });

  const resultados = await Promise.allSettled(promessas);
  await enviarDummy();

  tx.concluido = true;
  tx.depositHashes = resultados.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  stats.totalTxsConcluidas++;
  console.log(`\n Pipeline ETH [${txId}] concluido — ${tx.depositHashes.length}/${partes.length} splits\n`);
}

// ============================================================
// PIPELINE TOKEN
// ============================================================
async function executarPipelineToken(txId, tokenAddress, valorBruto, tokenSymbol, stealthAddress, ephemeralPubKey, viewTag, timelocked, entradaWallet, rede = "base") {
  const tx = fila.get(txId);
  if (!tx) return;

  const redeProvider = getRedeConfig(rede).provider;
  const mw = masterWallets[rede] || masterWallet;

  const { valorLiquido, taxa, bps } = descontarTaxa(valorBruto, tokenSymbol);
  console.log(`  Taxa coletada: ${taxa.toString()} units (${Number(bps)/100}%) [${rede}]`);

  if (tokenSymbol === "USDC") { stats.volumeUSDC += valorBruto; stats.receitaUSDC += taxa; }
  if (tokenSymbol === "USDT") { stats.volumeUSDT += valorBruto; stats.receitaUSDT += taxa; }

  let partes = splitEmDenominacoes(valorLiquido, tokenSymbol);
  if (!partes) partes = splitAleatorio(valorLiquido, 2);

  const numHopsPerSplit = 2;
  tx.hopsTotal = partes.length * numHopsPerSplit;
  tx.hopsFeitos = 0;
  tx.splits = partes.length;
  tx.taxaBps = Number(bps);

  console.log(`\n Pipeline Token [${txId}] [${rede}]: ${partes.length} splits${timelocked ? " [TIMELOCKED]" : ""}`);

  const depositHashes = [];
  for (let i = 0; i < partes.length; i++) {
    const valorParte = partes[i];
    console.log(`  Iniciando split token ${i+1}/${partes.length} - valor: ${valorParte.toString()} [${rede}]`);
    const delayProfile = gerarDelayProfile();
    try {
      const cadeia = Array.from({ length: numHopsPerSplit }, () => ethers.Wallet.createRandom().connect(redeProvider));
      await hopToken(entradaWallet || mw, cadeia[0].address, tokenAddress, valorParte, rede);
      console.log(`  -> Funded E${i+1}[0] com tokens`);

      for (let h = 0; h < cadeia.length - 1; h++) {
        const delay = delayAleatorio(delayProfile);
        console.log(`  Split ${i+1} hop ${h+1}: aguardando ${Math.round(delay/1000)}s...`);
        await sleep(delay);
        await enviarDummy();
        const saldo = await new ethers.Contract(tokenAddress, ERC20_ABI, redeProvider).balanceOf(cadeia[h].address);
        const ok = await hopToken(cadeia[h], cadeia[h+1].address, tokenAddress, saldo, rede);
        if (!ok) throw new Error(`Token hop ${h} falhou`);
        tx.hopsFeitos++;
      }

      const delayFinal = delayAleatorio(delayProfile);
      await sleep(delayFinal);
      await enviarDummy();
      const hash = await depositarTokenNoContrato(cadeia[cadeia.length-1], tokenAddress, valorParte, stealthAddress, ephemeralPubKey, viewTag, timelocked, rede);
      tx.hopsFeitos++;
      if (hash) depositHashes.push(hash);
      console.log(`  Split ${i+1} token concluido`);
    } catch (e) {
      console.error(`  Split token ${i} falhou: ${e.message} — fallback`);
      try {
        const hash = await depositarTokenNoContrato(mw, tokenAddress, valorParte, stealthAddress, ephemeralPubKey, viewTag, timelocked, rede);
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
      const redeCfg = getRedeConfig(entrada.rede || "base");
      const redeProvider = redeCfg.provider;
      let valorRecebido = 0n;

      if (entrada.token === "ETH") {
        valorRecebido = await redeProvider.getBalance(endereco);
      } else {
        const tokenInfo = redeCfg.tokens[entrada.token];
        if (!tokenInfo) continue;
        console.log(`  Checando saldo ${entrada.token} em ${endereco.slice(0,10)}... [${entrada.rede || "base"}]`);
        try {
          const tokenContract = new ethers.Contract(tokenInfo.address, ERC20_ABI, redeProvider);
          const saldo = await tokenContract.balanceOf(endereco);
          if (saldo === 0n) continue;
          valorRecebido = saldo;
        } catch (e2) {
          console.error(`balanceOf falhou: ${e2.message}`);
          continue;
        }
      } // fecha else token

      if (valorRecebido === 0n) continue;
      if (valorRecebido < getMinimo(entrada.token)) continue;

      console.log(`\n Entrada detectada: ${endereco.slice(0,10)}... recebeu ${entrada.token === 'ETH' ? ethers.formatEther(valorRecebido) : valorRecebido.toString()} ${entrada.token} [${entrada.rede || "base"}]`);
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
        executarPipelineETH(id, valorRecebido, entrada.stealthAddress, entrada.ephemeralPubKey, entrada.viewTag, entrada.timelocked || false, entrada.rede || "base")
          .catch(e => console.error(`Pipeline ETH erro:`, e.message));
      } else {
        const tokenAddr = redeCfg.tokens[entrada.token]?.address;
        if (!tokenAddr) { console.error(`Token ${entrada.token} nao encontrado na rede ${entrada.rede}`); continue; }
        try {
          const { taxa } = descontarTaxa(valorRecebido, entrada.token);
          console.log(`  Taxa calculada: ${taxa.toString()} [${entrada.rede}]`);
          if (taxa > 0n) {
            console.log(`  Financiando gas para ${entrada.wallet.address.slice(0,10)}...`);
            await financiarGas(entrada.wallet.address, entrada.rede || "base");
            console.log(`  Gas financiado! Transferindo taxa...`);
            const tokenContract = new ethers.Contract(tokenAddr, ERC20_ABI, entrada.wallet);
            const txTaxa = await tokenContract.transfer(masterWallets[entrada.rede || "base"].address, taxa);
            await txTaxa.wait();
            console.log(`  Taxa coletada: ${taxa.toString()} ${entrada.token} -> master [${entrada.rede}]`);
          }
          executarPipelineToken(id, tokenAddr, valorRecebido, entrada.token, entrada.stealthAddress, entrada.ephemeralPubKey, entrada.viewTag, entrada.timelocked || false, entrada.wallet, entrada.rede || "base")
            .catch(e => console.error(`Pipeline Token erro:`, e.message));
        } catch (e) { console.error(`Erro coletando taxa: ${e.message}`); }
      } // fecha else

    } catch (e) { console.error(`Erro monitorando ${endereco.slice(0,10)}...: ${e.message}`); }
  } // fecha for
} // fecha monitorarEntradas

setInterval(monitorarEntradas, 10000);
setInterval(dummyPeriodico, 120000 + Math.random() * 180000);
setInterval(() => {
  const agora = Date.now();
  for (const [id, tx] of fila.entries()) {
    if (tx.concluido && agora - tx.criadoEm > 2 * 60 * 60 * 1000) fila.delete(id);
  }
}, 30 * 60 * 1000);

// ============================================================
// ENDPOINTS
// ============================================================

app.get("/entrada", (req, res) => {
  try {
    const { token, stealthAddress, ephemeralPubKey, viewTag, timelocked, rede = "base" } = req.query;
    if (!token || !stealthAddress || !ephemeralPubKey || viewTag === undefined)
      return res.status(400).json({ erro: "Parametros incompletos" });

    const redeCfg = getRedeConfig(rede);
    const minimo = getMinimo(token);
    const wallet = ethers.Wallet.createRandom().connect(redeCfg.provider);

    entradasPendentes.set(wallet.address, {
      wallet, token, stealthAddress, ephemeralPubKey,
      viewTag: parseInt(viewTag), timelocked: timelocked === "true",
      criadoEm: Date.now(), resolveId: null,
      rede,
    });

    console.log(`Nova entrada gerada: ${wallet.address.slice(0,10)}... [${token}] [${rede}]${timelocked === "true" ? " [TIMELOCKED]" : ""}`);
    res.json({
      entradaAddress: wallet.address,
      token,
      rede,
      minimoWei: minimo.toString(),
      minimoFormatado: token === "ETH" ? ethers.formatEther(minimo) + " ETH" : ethers.formatUnits(minimo, 6) + " " + token,
      expiresIn: 1800,
    });
  } catch (e) { console.error(e); res.status(500).json({ erro: e.message }); }
});

app.get("/aguardar/:endereco", (req, res) => {
  const endereco = req.params.endereco;
  if (entradasPendentes.has(endereco)) return res.json({ recebido: false });
  for (const [id, tx] of [...fila.entries()].reverse()) {
    if (tx.entradaAddress === endereco) return res.json({ recebido: true, id });
  }
  return res.json({ recebido: false });
});

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
    minutosRestantes: Math.ceil(hopsRestantes * 2.5),
    splits: tx.splits || 2,
    taxaBps: tx.taxaBps || 20,
    depositHashes: tx.depositHashes || [],
  });
});

app.get("/minimos", (req, res) => {
  res.json({
    ETH:  { wei: MIN_ETH.toString(),  formatado: ethers.formatEther(MIN_ETH) + " ETH" },
    USDC: { wei: MIN_USDC.toString(), formatado: ethers.formatUnits(MIN_USDC, 6) + " USDC" },
    USDT: { wei: MIN_USDT.toString(), formatado: ethers.formatUnits(MIN_USDT, 6) + " USDT" },
  });
});

app.get("/taxas", (req, res) => {
  res.json({
    tiers: [
      { label: "Standard", maxLabel: "ate ~$500", bps: 20, percent: "0.20%" },
      { label: "Volume",   maxLabel: "$500 - $5,000", bps: 15, percent: "0.15%" },
      { label: "Premium",  maxLabel: "acima de $5,000", bps: 10, percent: "0.10%" },
    ],
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    filaSize: fila.size,
    entradasPendentes: entradasPendentes.size,
    pipelineAtivo,
    uptime: Math.floor((Date.now() - stats.iniciadoEm) / 1000),
  });
});

app.get("/admin/stats", (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).json({ erro: "Acesso negado" });
  const uptimeMs = Date.now() - stats.iniciadoEm;
  const uptimeHoras = (uptimeMs / (1000 * 60 * 60)).toFixed(1);
  let pipelinesAtivos = 0, pipelinesConcluidos = 0;
  for (const [, tx] of fila) {
    if (tx.concluido) pipelinesConcluidos++;
    else pipelinesAtivos++;
  }
  res.json({
    periodo: { iniciadoEm: new Date(stats.iniciadoEm).toISOString(), uptimeHoras: parseFloat(uptimeHoras) },
    transacoes: { total: stats.totalTxs, concluidas: stats.totalTxsConcluidas, ativas: pipelinesAtivos, naFila: fila.size },
    volume: {
      ETH:  ethers.formatEther(stats.volumeETH) + " ETH",
      USDC: ethers.formatUnits(stats.volumeUSDC, 6) + " USDC",
      USDT: ethers.formatUnits(stats.volumeUSDT, 6) + " USDT",
    },
    receita: {
      ETH:  ethers.formatEther(stats.receitaETH) + " ETH",
      USDC: ethers.formatUnits(stats.receitaUSDC, 6) + " USDC",
      USDT: ethers.formatUnits(stats.receitaUSDT, 6) + " USDT",
    },
    taxas: { tier1: "0.50% (ate ~$500)", tier2: "0.35% ($500-$5000)", tier3: "0.20% (acima $5000)" },
    privacidade: { dummiesEnviados: stats.dummiesEnviados },
    infra: { masterWallet: masterWallet.address, entradasPendentes: entradasPendentes.size, pipelineAtivo },
  });
});

app.post("/withdraw", async (req, res) => {
  try {
    const { stealthAddress, token, recipient, sig, rede = "base" } = req.body;
    if (!stealthAddress || !token || !recipient || !sig)
      return res.status(400).json({ erro: "Parametros incompletos" });

    const redeCfg = getRedeConfig(rede);
    const mw = masterWallets[rede] || masterWallet;
    const contrato = new ethers.Contract(redeCfg.contractAddress, [
      "function withdrawFor(address stealthAddress, address token, address recipient, bytes calldata sig) external",
      "function balanceOf(address stealthAddress, address token) external view returns (uint256)"
    ], mw);

    const bal = await contrato.balanceOf(stealthAddress, token);
    if (bal === 0n) return res.status(400).json({ erro: "Sem saldo para sacar" });

    const gasPrice = await getGasPrice(rede);
    const tx = await contrato.withdrawFor(stealthAddress, token, recipient, sig, { gasLimit: 200000n, gasPrice });
    await tx.wait();
    console.log(`Saque gasless: ${stealthAddress.slice(0,10)}... -> ${recipient.slice(0,10)}... [${rede}]`);
    res.json({ ok: true, hash: tx.hash });
  } catch (e) {
    console.error(`Erro no saque: ${e.message}`);
    res.status(500).json({ erro: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`SilentFlow backend v7 (Base + Polygon + BSC) — porta ${PORT}`);
  console.log(`Master wallet: ${masterWallet.address}`);
  console.log(`REDE: ${process.env.REDE || "NAO DEFINIDA"}`);
  console.log(`ALCHEMY_URL: ${process.env.ALCHEMY_URL ? process.env.ALCHEMY_URL.slice(0,50) + "..." : "NAO DEFINIDA"}`);
  console.log(`Contratos: Base ${REDES.base.contractAddress.slice(0,10)}... | Polygon ${REDES.polygon.contractAddress.slice(0,10)}... | BSC ${REDES.bsc.contractAddress.slice(0,10)}...`);
  console.log(`Taxas: ${Number(TIER1_BPS)/100}% (standard) / ${Number(TIER2_BPS)/100}% (volume) / ${Number(TIER3_BPS)/100}% (premium)`);
  console.log(`Minimos: ${ethers.formatEther(MIN_ETH)} ETH / ${ethers.formatUnits(MIN_USDC,6)} USDC / ${ethers.formatUnits(MIN_USDT,6)} USDT`);
});
 
