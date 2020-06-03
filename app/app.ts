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
import Twitter from 'twitter-lite';

const port = 2880;

const app: express.Application = express();
app.use(express.static('front/dist'));
app.use(bodyParser.json());

// Load state from state.json
// store is a map from tickets to addresses
// queue is a queue of tickets
const { store, queue, usedAddresses }: { 
    store: { [s: string]: { address?: string, name?: string, id_str?: string } },
    queue: string[],
    usedAddresses: { [s: string]: true },
} = require('../state.json');

// TODO: change when tweet text will be finalized.
function getTicketFromTweetText(text: string): string {
    const res = text.match(/\d{16}/g);
    if (res == null) return null;
    return res[0];
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

function addToQueueIfReady(ticket: string) {
    const { address, id_str } = store[ticket] || {};
    if (address == null) return;
    if (usedAddresses[address]) return;
    if (id_str == null) return;
    console.log(`Added ${address} with ticket ${ticket} to the store.`);
    queue.push(ticket);
}

async function processTweetObject(tweet) {
    const ticket = getTicketFromTweetText(tweet.text);

    if (!ticket) return;

    const name = tweet.user.name;
    const id_str = tweet.id_str;

    store[ticket] = { ...store[ticket], name, id_str };

    addToQueueIfReady(ticket);
}

app.get('/register_address/:address/:salt', async (req, res) => {
    try {
        let { address, salt } = req.params;

        if (address == undefined) {
            res.send("Error: missing address");
            return;
        }

        address = address.toLowerCase();

        if (! /^0x([0-9a-fA-F]){40}$/.test(address)) {
            res.send('Error: invalid zkSync address');
            return;
        }

        if (usedAddresses[address]) {
            res.send('Error: we already sent you funds');
            return;
        }

        const ticket = getTicketFromAddress(address, salt);

        store[ticket] = { ...store[ticket], address };

        addToQueueIfReady(ticket);

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

async function startSendingMoney(): Promise<void> {
    const ethProvider = new ethers.providers.JsonRpcProvider(process.env.WEB3_URL);
    const syncProvider = await zksync.Provider.newWebsocketProvider(process.env.WS_API_ADDR);

    const ethWallet = ethers.Wallet.fromMnemonic(process.env.MNEMONIC, "m/44'/60'/0'/0/0").connect(ethProvider);
    const syncWallet = await zksync.Wallet.fromEthSigner(ethWallet, syncProvider);

    while (true) {
        if (queue.length === 0) {
            await sleep(100);
            continue;
        }

        const ticket = queue[0];

        const { address, name, id_str } = store[ticket];

        const amounts = [
            { 
                token: 'ETH', 
                amount: parseEther('0.002'),
            },
        ];

        const hashes = [];
        for (const { token, amount } of amounts) {
            const transfer = await syncWallet.syncTransfer({
                to: address,
                token,
                amount,
                fee: parseEther('0.0'),
            });
    
            await transfer.awaitReceipt();
            hashes.push(transfer.txHash);
        }

        usedAddresses[address] = true;
        queue.shift();
        console.log(`Transfered funds to ${address}`);

        await client.post("statuses/update", {
            status: getTwitterReplyTextFromHashes(hashes, name),
            in_reply_to_status_id: id_str,
            auto_populate_reply_metadata: true
        });
    }
}


// Start API
app.listen(port, () => console.log(`App listening at http://localhost:${port}`));

// Start listening twitter stream
client.stream("statuses/filter", { track: "#berlinrightnow" })
    .on("data", processTweetObject)
    .on("error", error => console.error("Error in twitter stream:", error));

startSendingMoney();


process.stdin.resume(); //so the program will not close instantly

function exitHandler(options, exitCode) {
    if (options.cleanup) {
        const state = {
            store,
            queue,
            usedAddresses,
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
