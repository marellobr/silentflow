const { ethers } = require("ethers");

// Gera uma carteira mestre
const carteiraMestre = ethers.Wallet.createRandom();
console.log("🔑 Chave mestre (GUARDE ISSO):");
console.log("Endereço:", carteiraMestre.address);
console.log("Chave privada:", carteiraMestre.privateKey);

// Gera 3 endereços efêmeros derivados
console.log("\n👻 Endereços efêmeros gerados:");
for (let i = 0; i < 3; i++) {
  const efemero = ethers.Wallet.createRandom();
  console.log(`Endereço ${i + 1}:`, efemero.address);
}