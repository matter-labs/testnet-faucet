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

const port = 2880;

const app: express.Application = express();
app.use(express.static('front/dist'));
app.use(bodyParser.json());

// Load state from state.json
// store is a map from tickets to addresses
// queue is a queue of tickets
const { store, queue }: { 
    store: { [s: string]: string }, 
    queue: string[] 
} = require('../state.json');

app.get('/register_address/:address', async (req, res) => {
    try {
        const address = req.params.address;
        if (address == undefined) {
            res.send("Error: missing address");
            return;
        }

        if (! /^0x([0-9a-fA-F]){40}$/.test(address)) {
            res.send('Error: invalid zkSync address');
            return;
        }

        const ticket = getTicketFromAddress(address);

        if (store[ticket] == "already sent") {
            res.send('Error: we already sent you funds');
            return;
        }

        store[ticket] = address;

        console.log(`Added ${address} with ticket ${ticket} to the map.`);

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

        const ticket = await getTicketFromTweet(url);
        if (ticket == null) {
            res.send(`Error: couldn't find your early access ticket`);
            return;
        }
    
        if (store[ticket] == "already sent") {
            res.send('Error: we already sent you funds');
            return;
        }
    
        const address = store[ticket];
        if (address == null) {
            res.send('Error: unknown ticket. Register your address with /register_address and try again.');
            return;
        }
    
        queue.push(ticket);
    
        console.log(`Added ${address} with ticket ${ticket} to the queue.`);
    
        res.send("Success");
    } catch (e) {
        console.error("Error in validate_tweet:", e);
        res.send("Error: internal error");
    }
});

app.listen(port, () => console.log(`App listening at http://localhost:${port}`));

async function getTicketFromTweet(url): Promise<string | null> {
    const res = await axios.get(url).catch(e => {
        throw `Error: fetching ${url} failed with ${e.response.status}`;
    });
    
    const parser = new DomParser();
    const dom = parser.parseFromString(res.data);
    const text = dom.getElementsByTagName('p')
        .map(e => e.innerHTML)
        .map(s => s.match(/[0-9a-f]{20}/g))
        .filter(Boolean);
    if (text.length == 0) return null;

    // should never happen
    if (text[0].length == 0) return null;

    return text[0][0];
}

function getTicketFromAddress(address: string): string {
    const hash = crypto.createHash('sha256');
    hash.update(address.trim().toLowerCase());
    const digest = hash.digest('hex');
    return digest.slice(0, 20);
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
        if (store[ticket] == "already sent")
            continue;
        
        const address = store[ticket];

        const transferEth = await syncWallet.syncTransfer({
            to: address,
            token: 'ETH',
            amount: parseEther("0.002"),
            fee: parseEther('0.0'),
        });

        await transferEth.awaitReceipt();

        const transferERC20 = await syncWallet.syncTransfer({
            to: address,
            token: 'ERC20-1',
            amount: parseEther("0.002"),
            fee: parseEther('0.0'),
        });

        await transferERC20.awaitReceipt();

        store[ticket] = "already sent";
        queue.shift();
        console.log(`Transfered funds to ${address}`);
    }
}

startSendingMoney();


process.stdin.resume();//so the program will not close instantly

function exitHandler(options, exitCode) {
    if (options.cleanup) {
        const state = {
            store,
            queue,
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
