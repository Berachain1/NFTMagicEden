import inquirer from "inquirer";
import chalk from "chalk";
import figlet from "figlet";
import { ethers } from "ethers";
import { blockchain, nft, helpers } from "./api/index.js";
import { ENV, loadWallets } from "./config/env.chain.js";
import { ABI } from "./config/ABI.js";
import MONAD_TESTNET from "./config/chain.js";

let globalMintVariant = "twoParams";

const getCustomPrompt = (message, choices) => ({
  type: "list",
  message: message,
  choices: choices.map((choice, i) => ({
    name: i === 0 ? chalk.cyan(`> ${choice}`) : `  ${choice}`,
    value: choice,
  })),
  prefix: "?",
});

function displayBanner() {
  const width = process.stdout.columns || 80;

  // sanisa
  const bannerLines = figlet.textSync('ANNISA', {
    font: "ANSI Shadow",
    horizontalLayout: 'fitted'
  }).split('\n');

  // asika
  const half = Math.floor(bannerLines.length / 2);
  bannerLines.forEach((line, index) => {
    const padded = line.padStart(line.length + Math.floor((width - line.length) / 2));
    const color = index < half ? chalk.redBright : chalk.whiteBright;
    console.log(color(padded));
  });

  // Info
  const info1 = '=== my TG contact 🚀 : @Annisaazzahra123 ===';
  const info2 = '✪ MINT NFT ON MAGIC EDEN ✪';

  console.log('\n' + chalk.cyanBright(info1.padStart((width + info1.length) / 2)));
  console.log(chalk.yellowBright(info2.padStart((width + info2.length) / 2)) + '\n');
}

const extractContractAddress = (input) => {
  const magicEdenPattern =
    /magiceden\.io\/.*?\/(?:monad(?:-testnet)?\/)?([a-fA-F0-9x]{42})/i;
  const meMatch = input.match(magicEdenPattern);

  if (meMatch && meMatch[1]) {
    return meMatch[1].toLowerCase();
  }

  if (ethers.utils.isAddress(input)) {
    return input.toLowerCase();
  }

  return null;
};

const isUnlimitedSupply = (supply) => {
  return (
    !supply ||
    supply.eq(0) ||
    supply.gte(ethers.constants.MaxUint256.div(2)) ||
    supply.gte(ethers.BigNumber.from(2).pow(64).sub(1)) ||
    supply.eq(ethers.BigNumber.from("18446744073709551615")) ||
    supply.eq(
      ethers.BigNumber.from(
        "115792089237316195423570985008687907853269984665640564039457584007913129639935"
      )
    )
  );
};

async function main() {
  displayBanner();

  const wallets = loadWallets();
  if (wallets.length === 0) {
    helpers.log.error("No wallets found in .env file");
    helpers.log.normal("Add wallet to .env file: WALLET_1=0xprivatekey1");
    return;
  }

  const wallet = wallets[0];
  const provider = blockchain.createProvider(ENV.NETWORK);
  const mintOptions = await inquirer.prompt({
    type: "list",
    name: "mintOption",
    message: chalk.cyanBright("🚀 Pilih Mode Minting:"),
    choices: [
      { name: chalk.green("⚡ Instant Mint — Langsung eksekusi"), value: "instant" },
      { name: chalk.yellow("⏰ Scheduled Mint — Jalankan otomatis nanti"), value: "scheduled" },
    ],
    prefix: chalk.gray("❓"),
  });

  const contractAddressInput = await inquirer.prompt({
    type: "input",
    name: "contractAddressOrLink",
    message: chalk.cyan("🔗 Masukkan link Magic Eden atau alamat kontrak NFT:"),
    validate: (input) => {
      const address = extractContractAddress(input);
      return address ? true : chalk.red("⛔ Masukkan link atau address yang valid.");
    },
    prefix: chalk.gray("💡"),
  });

  const contractAddress = extractContractAddress(
    contractAddressInput.contractAddressOrLink
  );
  helpers.log.info(`Using contract address: ${contractAddress}`);

  try {
    const { name, symbol } = await nft.getCollectionInfo(
      contractAddress,
      provider
    );
    if (name !== "Unknown") {
      helpers.log.info(
        `Collection: ${name} ${symbol !== "Unknown" ? `(${symbol})` : ""}`
      );
    }
  } catch (error) {}

  const useContractPriceInput = await inquirer.prompt({
    type: "confirm",
    name: "useContractPrice",
    message: "Get price from contract?",
    default: true,
    prefix: "?",
  });

  let finalConfig = null;
  let derivedVariant = "twoParams";
  let zeroPrice = false;

  if (useContractPriceInput.useContractPrice) {
    try {
      const contractForConfig = blockchain.createContract(
        contractAddress,
        ABI,
        provider
      );
      const cfgResult = await nft.getConfigWithFallback(contractForConfig);
      if (cfgResult) {
        finalConfig = cfgResult.config;
        derivedVariant = cfgResult.variant;
        zeroPrice = false;
      }
    } catch (err) {
      helpers.log.error("Error retrieving config from contract");
    }
  } else {
    helpers.log.warning("Manual price input requested");
  }

  let mintPrice;
  if (finalConfig) {
    mintPrice = finalConfig.publicStage.price;
    globalMintVariant = derivedVariant;

    const ethPrice = ethers.utils.formatEther(mintPrice);
    if (mintPrice.eq(0)) {
      helpers.log.success(`This is a FREE MINT! (0 ${MONAD_TESTNET.SYMBOL})`);
    } else {
      helpers.log.success(
        `Price obtained from contract - [${ethPrice} ${MONAD_TESTNET.SYMBOL}]`
      );
    }

    if (finalConfig.maxSupply) {
      if (isUnlimitedSupply(finalConfig.maxSupply)) {
        helpers.log.info(`Supply: ♾️`);
      } else {
        helpers.log.info(`Supply: ${finalConfig.maxSupply.toString()}`);
      }
    }
  } else {
    helpers.log.error("Unable to retrieve Price from contract");
    const { manualPrice } = await inquirer.prompt({
      type: "input",
      name: "manualPrice",
      message: "MINT_PRICE (enter 0 for free mint):",
      validate: (input) => !isNaN(input) && Number(input) >= 0,
      prefix: "?",
    });

    mintPrice = ethers.utils.parseEther(manualPrice.toString());
    globalMintVariant = "twoParams";

    if (mintPrice.eq(0)) {
      helpers.log.info(`This is a FREE MINT! (0 ${MONAD_TESTNET.SYMBOL})`);
    } else {
      helpers.log.info(
        `Price is set to [${manualPrice} ${MONAD_TESTNET.SYMBOL}]`
      );
    }
  }

  if (
    mintOptions.mintOption === "Scheduled Mint" &&
    finalConfig &&
    finalConfig.publicStage.startTime
  ) {
    try {
      const startTime = finalConfig.publicStage.startTime.toNumber();
      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime < startTime) {
        helpers.log.warning("Scheduling Mint...");
        helpers.log.info(
          `Mint scheduled for [${blockchain.formatUnixTimestamp(startTime)}]`
        );

        const interval = setInterval(() => {
          const timeRemaining = helpers.getTimeRemaining(startTime);
          if (timeRemaining.totalSeconds <= 0) {
            clearInterval(interval);
            helpers.log.success("Starting mint now!");
          } else {
            process.stdout.write(
              `\r! Time remaining: ${timeRemaining.formatted}`
            );
          }
        }, 1000);

        await helpers.sleep((startTime - currentTime) * 1000);
        clearInterval(interval);
        console.log("\n");
      }
    } catch (err) {
      helpers.log.error(`Error scheduling startTime: ${err.message}`);
    }
  }

  const latestBlock = await provider.getBlock("latest");
  const baseFee = latestBlock.baseFeePerGas;
  const fee = baseFee.mul(125).div(100);

  const gasLimit = blockchain.getRandomGasLimit(
    ENV.DEFAULT_GAS_LIMIT_MIN,
    ENV.DEFAULT_GAS_LIMIT_MAX
  );

  helpers.log.info(
    `Using gasLimit: [${gasLimit}] globalMintVariant: [${globalMintVariant}]`
  );

  const explorerUrl = MONAD_TESTNET.TX_EXPLORER;

  try {
    const result = await nft.executeMint(
      contractAddress,
      blockchain.createWallet(wallet.privateKey, provider),
      gasLimit,
      fee,
      globalMintVariant,
      mintPrice,
      explorerUrl
    );

    if (
      result &&
      result.successVariant &&
      result.successVariant !== globalMintVariant
    ) {
      helpers.log.warning(`Updated mint method to: ${result.successVariant}`);
      globalMintVariant = result.successVariant;
    }
  } catch (err) {
    helpers.log.error(`Execution error: ${err.message}`);
    process.exit(1);
  }

  helpers.log.success("Minting process completed!");
}

main().catch((err) => {
  helpers.log.error(`Execution error: ${err.message}`);
  process.exit(1);
});
