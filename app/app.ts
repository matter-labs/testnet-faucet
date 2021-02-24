import express from 'express';
import bodyParser from 'body-parser';
import * as zksync from 'zksync';
import * as ethers from 'ethers';
import { sleep } from 'zksync/build/utils';
import * as fs from 'fs';
import {parseEther} from "ethers/lib/utils";

const port = 2880;

const app: express.Application = express();
app.use(bodyParser.json());
// app.use(express.urlencoded({ extended: true }));

// Load state from state.json
// store is a map from tickets to addresses
// queue is a queue of tickets
const { store, sendMoneyQueue, allowWithdrawalSet }: { 
    store: { [s: string]: { address?: string, name?: string, id_str?: string } },
    sendMoneyQueue: string[],
    allowWithdrawalSet: { [s: string]: true },
    // usedAddresses: { [s: string]: true },
} = require('../state.json');

app.post('/ask_money', async (req, res) => {
    try {
        let address = req.body['address'];
    
        if (address == undefined) {
            return res.send('Error: missing address');
        }

        address = address.trim().toLowerCase();

        if (! /^0x([0-9a-fA-F]){40}$/.test(address)) {
            return res.send('Error: invalid zkSync address');
        }

        sendMoneyQueue.push(address);

        res.send("Success");
    } catch (e) {
        console.error("Error in ask_money:", e);
        return res.send("Error: internal error");
    }
});

app.get('/is_withdraw_allowed/:address', async (req, res) => {
    return res.send(true);
})

app.get('/register_address/:address/:salt', async (req, res) => {
    try {
        return res.send("Success");
    } catch (e) {
        console.error("Error in register_address:", e);
        return res.send("Error: internal error");
    }
});


async function startSendingMoneyFragile(): Promise<void> {
    const syncProvider = await zksync.Provider.newHttpProvider(process.env.HTTP_RPC_API_ADDR);

    const ethWallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY);
    const syncWallet = await zksync.Wallet.fromEthSigner(ethWallet, syncProvider);

    if (! await syncWallet.isSigningKeySet()) {
        const setSigningKey = await syncWallet.setSigningKey({ feeToken: "MLTT" });
        await setSigningKey.awaitReceipt();
        console.log("Signing key is set");
    }


    const amounts = [
        {
            token: "DAI",
            amount: syncProvider.tokenSet.parseToken("DAI", "100"),
        },
        {
            token: "BAT",
            amount: syncProvider.tokenSet.parseToken("BAT", "100"),
        },
        {
            token: "MLTT",
            amount: syncProvider.tokenSet.parseToken("MLTT", "100"),
        },
    ];

    console.log(`Starting sending money from ${syncWallet.address()}`);
    for (const { token } of amounts) {
        console.log(`Sync balance for ${token}: ${await syncWallet.getBalance(token)}`);
    }

    while (true) {
        if (sendMoneyQueue.length === 0) {
            await sleep(100);
            continue;
        }

        const address = sendMoneyQueue[0];

        const hashes = [];
        for (const { token, amount } of amounts) {
            const transfer = await syncWallet.syncTransfer({
                to: address,
                token,
                amount
            });

            await transfer.awaitReceipt();
            hashes.push(transfer.txHash);
        }

        // usedAddresses[address] = true;
        sendMoneyQueue.shift();
        console.log(`Transfered funds to ${address}`);
    }
}

async function startSendingMoney() {
    let delay = 1000;
    let startTime;
    while (true) {
        try {
            startTime = Date.now();
            await startSendingMoneyFragile();
        } catch (e) {
            const runningTime = Date.now() - startTime;

            if (runningTime < 60000) {
                delay = Math.min(delay * 2, 600000);
            } else {
                delay = 1000;
            }

            console.error(`Error in startSending money:`, e);

            await sleep(delay);
        }
    }
}

// Start API
app.listen(port, () => console.log(`App listening at http://localhost:${port}`));

startSendingMoney();

process.stdin.resume(); //so the program will not close instantly

function exitHandler(options, exitCode) {
    if (options.cleanup) {
        const state = {
            store,
            sendMoneyQueue,
            allowWithdrawalSet,
            // usedAddresses,
        };
        fs.writeFileSync("state.json", JSON.stringify(state, null, 2));
    }

    if (exitCode || exitCode === 0) process.exit(exitCode);
    if (options.exit) process.exit();
}

// do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, {exit:true}));
process.on('SIGUSR2', exitHandler.bind(null, {exit:true}));

// catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));
