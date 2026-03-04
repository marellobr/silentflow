require("dotenv").config();
const { ethers } = require("ethers");

async function enviarComFee(destinatario, valorETH) {
  const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_URL);
  const carteira = new ethers.Wallet(process.env.CARTEIRA_PRIVADA, provider);

  // Calcula fee de 0.2%
  const valor = ethers.parseEther(valorETH);
  const fee = valor * 20n / 10000n;
  const valorFinal = valor - fee;

  console.log(`📤 Enviando...`);
  console.log(`💰 Valor original: ${valorETH} ETH`);
  console.log(`🔐 Fee SilentFlow (0.2%): ${ethers.formatEther(fee)} ETH`);
  console.log(`✅ Destinatário recebe: ${ethers.formatEther(valorFinal)} ETH`);

  const tx = await carteira.sendTransaction({
    to: destinatario,
    value: valorFinal,
  });

  console.log(`\n🚀 Transação enviada!`);
  console.log(`🔗 Hash: ${tx.hash}`);
  console.log(`🔍 Veja em: https://sepolia.etherscan.io/tx/${tx.hash}`);
}

// Teste: envia 0.001 ETH para um endereço efêmero
enviarComFee("0x299E5a883fA25F4Cf48410Ad0AFbA64BE84E5776", "0.001");
``