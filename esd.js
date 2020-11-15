const Web3 = require("web3");
const EthereumTx = require('ethereumjs-tx').Transaction;
const fs = require('fs');
const BigNumber = require('bignumber.js');

const CONFIG = {
  ADDRESS: "YOUR_ADDRESS",
  PRIVATE_KEY: "YOUR_PKEY",
  INFURA_KEY: "INFURA_KEY",

  START_BEFORE: 25, // in seconds (can be used to start sending tx 1 or 2 blocks before the advance())
  START_TIME: 1605398400000, // 00:00 15/11/2020 UTC - just arbitrary epoch time to use for reference
  EPOCH_DURATION: 28800000,  // 8 hours in millisecods

  GAS_PRICE: 50, // GWEI
  GAS_LIMIT: 300000,
  MAX_RETRY: 5, // how many attempts to try the transaction per each epoch advance()

  COUPON_EPOCH: 200, // epoch when you bought your coupons
  COUPON_AMOUNT: 100.00 // coupons amount
}

const ESD_ADDRESS = "0x443D2f2755DB5942601fa062Cc248aAA153313D3";
const ESD_ABI = JSON.parse(fs.readFileSync('./esd-abi.json'));

let web3 = new Web3(new Web3.providers.WebsocketProvider(
  `wss://mainnet.infura.io/ws/v3/${CONFIG.INFURA_KEY}`,
  {
      clientConfig: {
          maxReceivedFrameSize: 100000000,
          maxReceivedMessageSize: 100000000,
      }
  }
));

const EDS_CONTRACT = new web3.eth.Contract(ESD_ABI, ESD_ADDRESS)

const PURCHASE_TX = EDS_CONTRACT.methods.redeemCoupons(
  CONFIG.COUPON_EPOCH,
  web3.utils.toWei(CONFIG.COUPON_AMOUNT.toFixed(2), 'ether')
);

let state = {
  txNonce: 0,
  attempts: 0
}

const getNextEpochTime = () => {
  let epochsFromStart = Math.floor(((new Date().getTime()) - CONFIG.START_TIME) / CONFIG.EPOCH_DURATION)

  return CONFIG.START_TIME + (epochsFromStart+1) * CONFIG.EPOCH_DURATION;
}

const sendTransaction = () => {
  console.log("Sending transaction...");
    // construct the transaction data
    state.attempts++;

    const txData = {
      nonce: web3.utils.toHex(state.txNonce++),
      gasLimit: web3.utils.toHex(CONFIG.GAS_LIMIT),
      gasPrice: web3.utils.toHex(CONFIG.GAS_PRICE * 1000000000),
      to: ESD_ADDRESS,
      from: CONFIG.ADDRESS,
      data: PURCHASE_TX.encodeABI()
    }

    const privateKey = Buffer.from(CONFIG.PRIVATE_KEY, 'hex');
    const transaction = new EthereumTx(txData);
    transaction.sign(privateKey);
    const serializedTx = transaction.serialize().toString('hex');

    // on transaction confirmation, if reverted try again
    web3.eth.sendSignedTransaction('0x' + serializedTx)
      .on("confirmation", function(confirmationNumber, receipt){
        // only interested in 1st confirmation
        if (confirmationNumber == 0) {
          //if tx failed, retry
          if (!receipt.status) {
            console.log("Transaction reverted.")
            if (state.attempts < CONFIG.MAX_RETRY) {
              console.log(`Retrying... ${state.attempts}/${CONFIG.MAX_RETRY}`);
              sendTransaction()
            } else {
              // We reached MAX_RETRIES attempts, reset it and try next epoch
              state.attempts = 0;
              console.log("Max retries reached. Will try again next epoch.");
            }
          } else {
            console.log("Transaction success! :)");
          } 
        }
      })
      .on("error", () => {
        console.error
      });
}

(async () => {
  state.txNonce = await web3.eth.getTransactionCount(CONFIG.ADDRESS);

  let sub = web3.eth.subscribe('newBlockHeaders', (error, blockHeader) => {
    if (error) {
      console.error(`Unable to subscribe to new blocks: ${error}`);
      return;
    }

    if (blockHeader.number == null) {
      return;
    }

    let blockTime = blockHeader.timestamp * 1000;

    let startTime = getNextEpochTime() - (CONFIG.START_BEFORE * 1000);

    if (state.attempts == 0) {
      console.log(`New Block: ${blockHeader.number}`);
      console.log(`Block Timestamp: ${blockTime}`);
      console.log(`Time Left till Next Epoch: ${Math.round((startTime - blockTime)/1000)} seconds\n`);

      if (blockTime >= startTime) {
        sendTransaction();
      }
    }
  })
  .on("connected", (subscriptionId) => {
    console.log(`Subscribing to new block: SUCCESS\nListening...\n`);
  })
  .on("data", (data) => {})
  .on("error", console.error);
})();