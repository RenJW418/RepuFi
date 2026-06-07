import "@nomicfoundation/hardhat-toolbox";
import { HardhatUserConfig } from "hardhat/config";

loadEnv();

const testnetUrl = process.env.REPUFI_TESTNET_RPC_URL;
const testnetPrivateKey = process.env.REPUFI_TESTNET_PRIVATE_KEY;
const testnetChainId = parseChainId(process.env.REPUFI_TESTNET_CHAIN_ID);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    },
    testnet: {
      url: testnetUrl ?? "http://127.0.0.1:8545",
      chainId: testnetChainId,
      accounts: testnetPrivateKey ? [normalizePrivateKey(testnetPrivateKey)] : []
    }
  }
};

export default config;

function loadEnv() {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  for (const file of [path.resolve(process.cwd(), "../.env.local"), path.resolve(process.cwd(), ".env.local")]) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

function normalizePrivateKey(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function parseChainId(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
