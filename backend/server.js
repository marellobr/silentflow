const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_URL);

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

// masterWallet: usado apenas para financiar gas das wallets efêmeras
const masterWallet = new ethers.Wallet(process.env.CARTEIRA_PRIVADA, provider);

// Fila em memória — nunca persiste em disco
const fila = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function delayAleatorio(minS = 30, maxS = 180) {
  return (minS + Math.random() * (maxS - minS)) * 1000;
}

function splitAleatorio(total, partes) {
  // total é BigInt (wei)
  const vals = [];
  let restante = total;
  for (let i = 0; i < partes - 1; i++) {
    // entre 20% e 50% do restante
    const min = restante / 5n;
    const max = restante / 2n;
    const range = max - min;
    const rand = BigInt(Math.floor(Math.random() * Number(range)));
    vals.push(min + rand);
    restante -= min + rand;
  }
  vals.push(restante);
  // embaralha
  return vals.sort(() => Math.random() - 0.5);
}

async function getGasPrice() {
  const feeData = await provider.getFeeData();
  return feeData.gasPrice;
}

// Custo de gas para transferência simples ETH (21000 gas)
async function estimarCustoGasETH() {
  const gasPrice = await getGasPrice();
  return gasPrice * 21000n;
}

// Custo de gas para depositETH no contrato (~80000 gas)
async function estimarCustoGasDeposit() {
  const gasPrice = await getGasPrice();
  return gasPrice * 100000n; // margem de segurança
}

// Financia uma wallet efêmera com ETH suficiente para pagar gas de transferência
async function financiarGas(destino) {
  const gasNeeded = await estimarCustoGasETH();
  // Manda 3x o custo estimado para garantir
  const valor = gasNeeded * 3n;
  const tx = await masterWallet.sendTransaction({
    to: destino,
    value: valor,
    gasLimit: 21000n,
  });
  await tx.wait();
  return valor;
}

// ─── ETH: executa um hop real ─────────────────────────────────────────────────

async function hopETH(deWallet, paraEndereco, valor) {
  const gasPrice = await getGasPrice();
  const gasCost = gasPrice * 21000n;

  // Garante que o valor a enviar cobre o gas
  const saldo = await provider.getBalance(deWallet.address);
  const enviar = saldo - gasCost;

  if (enviar <= 0n) {
    console.error(`hopETH: saldo insuficiente em ${deWallet.address}`);
    return false;
  }

  try {
    const tx = await deWallet.sendTransaction({
      to: paraEndereco,
      value: enviar,
      gasLimit: 21000n,
      gasPrice,
    });
    await tx.wait();
    console.log(`  ✓ ETH hop: ${deWallet.address.slice(0,8)}... → ${paraEndereco.slice(0,8)}... (${ethers.formatEther(enviar)} ETH)`);
    return true;
  } catch (e) {
    console.error(`  ✗ hopETH falhou: ${e.message}`);
    return false;
  }
}

// ─── ETH: deposita no contrato a partir da última wallet efêmera ──────────────

async function depositarETHNoContrato(wallet, stealthAddress, ephemeralPubKey, viewTag) {
  const gasPrice = await getGasPrice();
  const gasLimit = 120000n;
  const gasCost = gasPrice * gasLimit;

  const saldo = await provider.getBalance(wallet.address);
  const valor = saldo - gasCost;

  if (valor <= 0n) {
    console.error(`depositarETH: saldo insuficiente em ${wallet.address}`);
    return null;
  }

  const contrato = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
  try {
    const tx = await contrato.depositETH(stealthAddress, ephemeralPubKey, viewTag, {
      value: valor,
      gasLimit,
      gasPrice,
    });
    await tx.wait();
    console.log(`  ✓ depositETH no contrato: ${ethers.formatEther(valor)} ETH → stealth ${stealthAddress.slice(0,10)}...`);
    return tx.hash;
  } catch (e) {
    console.error(`  ✗ depositETH falhou: ${e.message}`);
    return null;
  }
}

// ─── TOKEN: financia gas ETH + hop token ─────────────────────────────────────

async function hopToken(deWallet, paraEndereco, tokenAddress, valor) {
  // Financia gas do master para pagar o transfer ERC-20
  await financiarGas(deWallet.address);

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, deWallet);
  try {
    const tx = await token.transfer(paraEndereco, valor);
    await tx.wait();
    console.log(`  ✓ Token hop: ${deWallet.address.slice(0,8)}... → ${paraEndereco.slice(0,8)}...`);
    return true;
  } catch (e) {
    console.error(`  ✗ hopToken falhou: ${e.message}`);
    return false;
  }
}

async function depositarTokenNoContrato(wallet, tokenAddress, valor, stealthAddress, ephemeralPubKey, viewTag) {
  // Financia gas
  await financiarGas(wallet.address);

  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const contratoContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

  try {
    // Approve
    const approveTx = await tokenContract.approve(CONTRACT_ADDRESS, valor);
    await approveTx.wait();

    // Deposit
    const gasPrice = await getGasPrice();
    const tx = await contratoContract.depositToken(
      tokenAddress, valor, stealthAddress, ephemeralPubKey, viewTag,
      { gasLimit: 150000n, gasPrice }
    );
    await tx.wait();
    console.log(`  ✓ depositToken no contrato → stealth ${stealthAddress.slice(0,10)}...`);
    return tx.hash;
  } catch (e) {
    console.error(`  ✗ depositToken falhou: ${e.message}`);
    return null;
  }
}

// ─── Dummy: transações de ruído ───────────────────────────────────────────────
let pipelineAtivo = false;

async function enviarDummy() {
  if (pipelineAtivo) return; // não interferir com nonces durante funding
  if (Math.random() > 0.5) return;
  try {
    const efemero = ethers.Wallet.createRandom();
    const gasPrice = await getGasPrice();
    await masterWallet.sendTransaction({
      to: efemero.address,
      value: ethers.parseEther("0.00001"),
      gasLimit: 21000n,
      gasPrice,
    });
    console.log(`  ~ dummy noise → ${efemero.address.slice(0,10)}...`);
  } catch {
    // silencioso
  }
}

// ─── Pipeline principal ───────────────────────────────────────────────────────
//
// Fluxo ETH:
//   1. Recebe valor total em ETH na master wallet (veio do frontend via txHash)
//   2. Divide em N partes
//   3. Para cada parte: cria cadeia de wallets efêmeras, move ETH entre elas com delays
//   4. Última wallet efêmera chama depositETH(contrato, stealthAddress)
//
// Fluxo Token:
//   1. Tokens já estão na master wallet (aprovados pelo frontend)
//   2. Divide em N partes
//   3. Para cada parte: move tokens entre wallets efêmeras (master paga gas)
//   4. Última wallet efêmera chama depositToken(contrato, stealthAddress)

async function executarPipelineETH(txId, valorTotal, stealthAddress, ephemeralPubKey, viewTag) {
  const tx = fila.get(txId);
  if (!tx) return;

  const numSplits = 2 + Math.floor(Math.random() * 2); // 2 ou 3 splits
  const numHopsPerSplit = 2; // 2 hops por split
  const partes = splitAleatorio(valorTotal, numSplits);

  tx.hopsTotal = partes.length * numHopsPerSplit;
  tx.hopsFeitos = 0;
  tx.splits = partes.length;

  console.log(`\n🔀 Pipeline ETH [${txId}]: ${partes.length} splits, ${numHopsPerSplit} hops cada`);

  // Cria todas as cadeias de wallets efêmeras
  const cadeias = partes.map(() =>
    Array.from({ length: numHopsPerSplit }, () =>
      ethers.Wallet.createRandom().connect(provider)
    )
  );

  // FASE 1: Financia wallets iniciais EM SÉRIE (evita conflito de nonce na master)
  pipelineAtivo = true;
  const gasDeposit = await estimarCustoGasDeposit();
  const gasHops = (await estimarCustoGasETH()) * BigInt(numHopsPerSplit);
  const gasExtra = await estimarCustoGasETH();

  for (let i = 0; i < partes.length; i++) {
    const valorComGas = partes[i] + gasDeposit + gasHops + gasExtra;
    console.log(`  Split ${i + 1}: ${ethers.formatEther(partes[i])} ETH`);
    const txInicial = await masterWallet.sendTransaction({
      to: cadeias[i][0].address,
      value: valorComGas,
      gasLimit: 21000n,
    });
    await txInicial.wait();
    console.log(`  → Funded E${i+1}[0]: ${cadeias[i][0].address.slice(0,10)}...`);
  }

  // FASE 2: Hops em paralelo (cada split já tem seu ETH, sem depender da master)
  pipelineAtivo = false;
  const promessas = partes.map(async (valorParte, i) => {
    const cadeia = cadeias[i];
    try {

      // Hops intermediários com delays
      for (let h = 0; h < cadeia.length - 1; h++) {
        const delay = delayAleatorio(30, 120);
        console.log(`  ⏱ Split ${i+1} hop ${h+1}: aguardando ${Math.round(delay/1000)}s...`);
        await sleep(delay);

        // Dummy noise enquanto espera (já passou o delay)
        await enviarDummy();

        const ok = await hopETH(cadeia[h], cadeia[h + 1].address, 0n);
        if (!ok) throw new Error(`Hop ${h} falhou no split ${i}`);

        tx.hopsFeitos++;
        console.log(`  Split ${i+1} hop ${h+1}/${cadeia.length-1} concluído`);
      }

      // Delay antes do depósito final
      const delayFinal = delayAleatorio(30, 120);
      console.log(`  ⏱ Split ${i+1} depósito final: aguardando ${Math.round(delayFinal/1000)}s...`);
      await sleep(delayFinal);

      // Última wallet deposita no contrato
      const depositHash = await depositarETHNoContrato(
        cadeia[cadeia.length - 1],
        stealthAddress,
        ephemeralPubKey,
        viewTag
      );

      tx.hopsFeitos++;

      if (!depositHash) throw new Error(`Depósito final falhou no split ${i}`);

      console.log(`  ✅ Split ${i+1} concluído — depositado no contrato`);
      return depositHash;

    } catch (e) {
      console.error(`  ✗ Split ${i} falhou: ${e.message}`);
      // Fallback: tenta depositar direto da master (pior caso)
      console.log(`  ⚠️  Fallback: depositando direto da master para split ${i}...`);
      try {
        const gasPrice = await getGasPrice();
        const contratoFallback = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, masterWallet);
        const txFb = await contratoFallback.depositETH(stealthAddress, ephemeralPubKey, viewTag, {
          value: valorParte,
          gasLimit: 120000n,
          gasPrice,
        });
        await txFb.wait();
        return txFb.hash;
      } catch (e2) {
        console.error(`  ✗ Fallback também falhou: ${e2.message}`);
        return null;
      }
    }
  });

  const resultados = await Promise.allSettled(promessas);
  tx.concluido = true;
  tx.depositHashes = resultados
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  console.log(`\n✅ Pipeline ETH [${txId}] concluído — ${tx.depositHashes.length}/${partes.length} splits no contrato\n`);
}

async function executarPipelineToken(txId, tokenAddress, valorTotal, stealthAddress, ephemeralPubKey, viewTag) {
  const tx = fila.get(txId);
  if (!tx) return;

  const numSplits = 2;
  const numHopsPerSplit = 2;
  const partes = splitAleatorio(valorTotal, numSplits);

  tx.hopsTotal = partes.length * numHopsPerSplit;
  tx.hopsFeitos = 0;
  tx.splits = partes.length;

  console.log(`\n🔀 Pipeline Token [${txId}]: ${partes.length} splits`);

  const promessas = partes.map(async (valorParte, i) => {
    try {
      const cadeia = Array.from({ length: numHopsPerSplit }, () =>
        ethers.Wallet.createRandom().connect(provider)
      );

      // Transfere tokens da master para primeira wallet efêmera
      await hopToken(masterWallet, cadeia[0].address, tokenAddress, valorParte);
      console.log(`  → Funded E${i+1}[0] com tokens`);

      // Hops intermediários
      for (let h = 0; h < cadeia.length - 1; h++) {
        const delay = delayAleatorio(30, 120);
        console.log(`  ⏱ Split ${i+1} hop ${h+1}: aguardando ${Math.round(delay/1000)}s...`);
        await sleep(delay);

        await enviarDummy();

        const saldoToken = await new ethers.Contract(tokenAddress, ERC20_ABI, provider)
          .balanceOf(cadeia[h].address);
        const ok = await hopToken(cadeia[h], cadeia[h + 1].address, tokenAddress, saldoToken);
        if (!ok) throw new Error(`Token hop ${h} falhou no split ${i}`);

        tx.hopsFeitos++;
      }

      // Delay final
      const delayFinal = delayAleatorio(30, 120);
      await sleep(delayFinal);

      // Última wallet deposita no contrato
      const saldoFinal = await new ethers.Contract(tokenAddress, ERC20_ABI, provider)
        .balanceOf(cadeia[cadeia.length - 1].address);

      const depositHash = await depositarTokenNoContrato(
        cadeia[cadeia.length - 1],
        tokenAddress,
        saldoFinal,
        stealthAddress,
        ephemeralPubKey,
        viewTag
      );

      tx.hopsFeitos++;
      console.log(`  ✅ Split ${i+1} token concluído`);
      return depositHash;

    } catch (e) {
      console.error(`  ✗ Split token ${i} falhou: ${e.message}`);
      // Fallback direto da master
      try {
        return await depositarTokenNoContrato(
          masterWallet, tokenAddress, valorParte,
          stealthAddress, ephemeralPubKey, viewTag
        );
      } catch {
        return null;
      }
    }
  });

  const resultados = await Promise.allSettled(promessas);
  tx.concluido = true;
  tx.depositHashes = resultados
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  console.log(`\n✅ Pipeline Token [${txId}] concluído\n`);
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

// POST /agendar
// Body: { txHash, token, valor (string em wei), stealthAddress, ephemeralPubKey, viewTag }
//
// IMPORTANTE: para ETH, o frontend deve ter enviado o ETH para masterWallet.address ANTES de chamar este endpoint
// Para tokens, o frontend deve ter feito approve + transfer para masterWallet.address

app.post("/agendar", async (req, res) => {
  try {
    const { txHash, token, valor, stealthAddress, ephemeralPubKey, viewTag } = req.body;

    if (!txHash || !token || !valor || !stealthAddress || !ephemeralPubKey || viewTag === undefined) {
      return res.status(400).json({ erro: "Parâmetros incompletos" });
    }

    const id = `sf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const valorBigInt = BigInt(valor);

    fila.set(id, {
      id,
      txHash,
      token,
      valorTotal: valorBigInt.toString(),
      stealthAddress,
      ephemeralPubKey,
      viewTag,
      hopsFeitos: 0,
      hopsTotal: 4, // estimativa inicial: 2 splits × 2 hops
      splits: 2,
      concluido: false,
      criadoEm: Date.now(),
      depositHashes: [],
    });

    // Estimativa: 2 splits × 2 hops × ~2min each = ~8min max
    const estimativaMinutos = 8;

    console.log(`📥 Nova tx agendada: ${id} — ${token} — ${ethers.formatUnits(valorBigInt, token === 'ETH' ? 18 : 6)}`);

    // Responde imediatamente, pipeline roda em background
    res.json({ id, estimativaMinutos, masterAddress: masterWallet.address });

    // Dispara pipeline em background
    const TOKENS = {
      USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      USDT: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0",
    };

    if (token === "ETH") {
      executarPipelineETH(id, valorBigInt, stealthAddress, ephemeralPubKey, viewTag)
        .catch(e => console.error(`Pipeline ETH [${id}] erro:`, e.message));
    } else {
      const tokenAddress = TOKENS[token];
      if (!tokenAddress) {
        fila.get(id).concluido = true;
        return;
      }
      executarPipelineToken(id, tokenAddress, valorBigInt, stealthAddress, ephemeralPubKey, viewTag)
        .catch(e => console.error(`Pipeline Token [${id}] erro:`, e.message));
    }

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: e.message });
  }
});

app.get("/status/:id", (req, res) => {
  const tx = fila.get(req.params.id);
  if (!tx) return res.status(404).json({ erro: "Não encontrado" });

  const hopsFeitos = tx.hopsFeitos || 0;
  const hopsTotal = tx.hopsTotal || 4;
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

app.get("/master", (req, res) => {
  res.json({ address: masterWallet.address });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, filaSize: fila.size });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 SilentFlow backend v3 (real hops) rodando na porta ${PORT}`);
  console.log(`📬 Master wallet: ${masterWallet.address}`);
});
