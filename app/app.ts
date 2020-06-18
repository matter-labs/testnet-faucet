import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import DomParser  = require('dom-parser');
import crypto from 'crypto';
import * as zksync from 'zksync';
import * as ethers from 'ethers';
import { parseEther } from 'ethers/utils';
import { sleep } from 'zksync/build/utils';
import * as fs from 'fs';
import Twitter, { Stream } from 'twitter-lite';
import * as qs from 'querystring';

const port = 2880;

const app: express.Application = express();
app.use(express.static('front/dist'));
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

// TODO: change when tweet text will be finalized.
function getTicketFromTweetText(text: string): string {
    const res = text.match(/\d{16}/g);
    if (res == null) return null;
    return res[0];
}

function notifyTelegram(text: string) {
    axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
        "chat_id": process.env.TELEGRAM_CHAT_ID,
        text: `${process.env.DEPLOYMENT_NAME}: ${text}`,
    });
}

// TODO: change when tweet text will be finalized.
function getTwitterReplyTextFromHashes(hashes: string[], name?: string): string {
    return `${name}, we got you.`;
}

const client = new Twitter({
    subdomain: "api", // "api" is the default (change for other subdomains)
    version: "1.1", // version "1.1" is the default (change for other subdomains)
    consumer_key: process.env.CONSUMER_KEY,
    consumer_secret: process.env.CONSUMER_SECRET,
    access_token_key: process.env.ACCESS_TOKEN_KEY,
    access_token_secret: process.env.ACCESS_TOKEN_SECRET,
});

function allowWithdrawal(ticket: string) {
    const { address, id_str } = store[ticket] || {};
    if (address == null) return;
    if (id_str == null) return;

    console.log(`Allowed withdrawal for ${address} with ticket ${ticket}.`);

    allowWithdrawalSet[address] = true;
}

async function processTweetObject(tweet) {
    const ticket = getTicketFromTweetText(tweet.text);

    if (!ticket) return;

    const name = tweet.user.name;
    const id_str = tweet.id_str;

    store[ticket] = { ...store[ticket], name, id_str };

    console.log(`Processed tweet object ${id_str}`);

    allowWithdrawal(ticket);
}

app.post('/ask_money', async (req, res) => {
    try {
        let response = req.body['g-recaptcha-response'];
        let address = req.body['address'];
    
        if (address == undefined) {
            return res.send('Error: missing address');
        }

        address = address.trim().toLowerCase();

        if (! /^0x([0-9a-fA-F]){40}$/.test(address)) {
            return res.send('Error: invalid zkSync address');
        }

        // if (usedAddresses[address]) {
        //     return res.send('Error: we already sent you funds');
        // }

        if (response == undefined) {
            return res.send(`Error: missing token.`);
        }

        const verify = await axios.post(
            `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.CAPTCHA_SERVER_KEY}&response=${response}`,
            {},
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"
                },
            },
        );
    
        if (verify.data.success == false) {
            return res.send(`Error: captcha verification failed`);
        }
    
        sendMoneyQueue.push(address);

        res.send("Success");
    } catch (e) {
        console.error("Error in ask_money:", e);
        return res.send("Error: internal error");
    }
});

app.get('/is_withdraw_allowed/:address', async (req, res) => {
    const address = req.params.address.trim().toLocaleLowerCase();
    return res.send(allowWithdrawalSet[address] === true);
})

app.get('/register_address/:address/:salt', async (req, res) => {
    try {
        let { address, salt } = req.params;

        if (address == undefined) {
            return res.send("Error: missing address");
        }

        address = address.toLowerCase();

        if (! /^0x([0-9a-fA-F]){40}$/.test(address)) {
            return res.send('Error: invalid zkSync address');
        }

        const ticket = getTicketFromAddress(address, salt);

        store[ticket] = { ...store[ticket], address };

        allowWithdrawal(ticket);

        res.send("Success");
    } catch (e) {
        console.error("Error in register_address:", e);
        res.send("Error: internal error");
    }
});

app.get('/validate_tweet/:url', async (req, res) => {
    try {
        if (req.params.url == undefined) {
            res.send("Error: missing tweet url");
            return;
        }

        const url = req.params.url.trim();

        if (! /^https:\/\/twitter.com\/.+\/status\/\d{19}\/?$/.test(url)) {
            res.send('Error: invalid tweet url');
            return;
        }

        // get id of the tweet
        const matches = url.match(/\d{19}/g);
        if (matches == null) return null;
        const id = matches[matches.length - 1];

        // get tweet object
        const tweet = await client.get("statuses/show", { id });

        // add address to queue if needed
        await processTweetObject(tweet);
    
        res.send("Success");
    } catch (e) {
        console.error("Error in validate_tweet:", e);
        res.send("Error: internal error");
    }
});

function getTicketFromAddress(address: string, salt: string): string {
    const preimage = (String(address).trim() + String(salt).trim()).toLowerCase();
    
    const hash = crypto.createHash('sha256');
    hash.update(preimage);
    
    // 13 hex char numbers fit in a double
    const digest = hash.digest('hex').slice(0, 13);
    return parseInt(digest, 16).toString().padStart(16, '0');
}

async function startSendingMoneyFragile(): Promise<void> {
    const ethProvider = new ethers.providers.JsonRpcProvider(process.env.WEB3_URL);
    // const syncProvider = await zksync.Provider.newWebsocketProvider(process.env.WS_API_ADDR);
    const syncProvider = await zksync.Provider.newHttpProvider(process.env.HTTP_RPC_API_ADDR);

    const ethWallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY).connect(ethProvider);
    const syncWallet = await zksync.Wallet.fromEthSigner(ethWallet, syncProvider);

    const amounts = [
        {
            token: process.env.TEST_TOKEN,
            amount: parseEther('100'),
        },
    ];

    console.log(`Starting sending money from ${syncWallet.address()}`);
    for (const { token } of amounts) {
        console.log(`Sync balance for ${token}: ${await syncWallet.getBalance(token)}`);
        console.log(`Eth balance for ${token}: ${await syncWallet.getEthereumBalance(token)}`);
    }

    while (true) {
        if (sendMoneyQueue.length === 0) {
            await sleep(100);
            continue;
        }

        const address = sendMoneyQueue[0];

        // if (usedAddresses[address]) {
        //     sendMoneyQueue.shift();
        //     continue;
        // }

        const hashes = [];
        for (const { token, amount } of amounts) {
            const transfer = await syncWallet.syncTransfer({
                to: address,
                token,
                amount
            });

            // await transfer.awaitReceipt();
            hashes.push(transfer.txHash);
        }

        // usedAddresses[address] = true;
        sendMoneyQueue.shift();
        console.log(`Transfered funds to ${address}`);

        // await client.post("statuses/update", {
        //     status: getTwitterReplyTextFromHashes(hashes, name),
        //     in_reply_to_status_id: id_str,
        //     auto_populate_reply_metadata: true
        // });
    }
}

async function startSendingMoney() {
    let delay = 1;
    let startTime;
    while (true) {
        try {
            await sleep(delay);
            startTime = Date.now();
            await startSendingMoneyFragile();
        } catch (e) {
            const runningTime = Date.now() - startTime;

            if (runningTime < 60000) {
                delay *= 2;
            } else {
                delay = 1;
            }

            console.error(`Error in startSending money:`, e);
            notifyTelegram(`Error in startSending money: ${e.toString()}`);
        }
    }
}

// Start listening twitter stream
function startListeningTwitterStream() {
    return client
        .stream("statuses/filter", { track: "#zksync_claim" })
        .on("data", processTweetObject)
        .on("error", error => {
            notifyTelegram(`Error in twitter stream: ${JSON.stringify(error, null, 2)}`);
            console.error('Error in twitter stream:', error);
        });
}

function getSymbolProperty(object, name) {
    const symbols = Object.getOwnPropertySymbols(object).filter(s => String(s) === name);
    if (symbols.length === 0) return undefined;
    return object[symbols[0]];
}

// function startListeningTwitterStream(backoffAmount = 10): Promise<Stream> {
//     return new Promise(async (resolve, reject) => {
//         const stream = client
//             .stream("statuses/filter", { track: "#zksync_claim" })
//             .on("data", processTweetObject)
//             .on("error", async error => {
//                 const responseInternals = getSymbolProperty(error, 'Symbol(Response internals)');
//                 if (responseInternals && responseInternals.statusText === "Enhance Your Calm") {
//                     console.log("Enhancing our calm");
//                     await sleep(backoffAmount);
//                     resolve(await startListeningTwitterStream(backoffAmount * 2));
//                 } else {
//                     console.error("Error in twitter stream:", error);
//                     reject(error);
//                 }
//             });
//         await sleep(10);
//         resolve(stream);
//     });
// }

notifyTelegram("Starting");

// Start API
app.listen(port, () => console.log(`App listening at http://localhost:${port}`));

startSendingMoney();
startListeningTwitterStream();


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
