import * as zksync from 'zksync';
import * as ethers from 'ethers';
import { parseEther, formatEther } from 'ethers/utils';

(async () => {
    const ethProvider = new ethers.providers.JsonRpcProvider(process.env.WEB3_URL);
    const syncProvider = await zksync.Provider.newWebsocketProvider(process.env.WS_API_ADDR);
    
    const ethWallet = ethers.Wallet.fromMnemonic(process.env.MNEMONIC, "m/44'/60'/0'/0/0").connect(ethProvider);
    const syncWallet = await zksync.Wallet.fromEthSigner(ethWallet, syncProvider);
    
    console.log(await syncProvider.getTokens());
    const token = "ETH";
    console.log('Balance of ' + token + ': ' + formatEther(await syncWallet.getEthereumBalance(token)));
    if (! await syncWallet.isSigningKeySet()) {
        const changePubKey = await syncWallet.setSigningKey();
        await changePubKey.awaitReceipt();
        console.log('changePubKey hash:', changePubKey.txHash);
    }
    
    const deposit = await syncWallet.depositToSyncFromEthereum({
        depositTo: syncWallet.address(),
        token,
        amount: parseEther("0.9"),
        approveDepositAmountForERC20: true,
    });
    await deposit.awaitReceipt();
    console.log('deposit hash:', deposit.ethTx.hash);
})();
