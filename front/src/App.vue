<template>
  <div v-if="ready">
    <div id="app">
      Your address:
      <input v-model="address" type="text" />
      <div>Address: {{cleanAddress}}, salt: {{salt}}, ticket: {{ticketHash}}</div>
      <div id="tweetButtonPlaceholder" />
      <div><button @click="getMoney">Is withdraw allowed</button></div>
      <div>Is withdraw allowed response: {{ isWithdrawAllowedResponse }}</div>
      <div class="g-recaptcha" data-sitekey="6LdEBqUZAAAAAMAr2XDTxJHuXOxpQ7rfkn2BBfUo"></div>
      <br/>
      <input type="submit" value="Submit captcha" @click="askMoney">
      <div>Ask money response: {{ askMoneyOut }}</div>
    </div>  
  </div>
</template>

<script>
import crypto from 'crypto';
import axios from 'axios';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: 'App',
  data: () => ({
    address: "",
    tweetUrl: "",
    ready: false,
    salt: '',
    askMoneyOut: '',
    isWithdrawAllowedResponse: '',
  }),
  methods: {
    async getMoney() {
      const res = await axios.get(`/is_withdraw_allowed/${this.cleanAddress}`);
      this.isWithdrawAllowedResponse = res.data;
    },
    async askMoney() {
      const res = await fetch("/ask_money", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          address: this.cleanAddress,
          'g-recaptcha-response': grecaptcha.getResponse(),
        })
      });

      this.askMoneyOut = await res.text();
    }
  },
  watch: {
    address() {
      const elem = document.getElementById('tweetButtonPlaceholder');
      if (this.addressOk) {
        const options = { 
          text: this.tweetText,
        };
        twttr.widgets.createShareButton('/', elem, options);
      } else {
        elem.innerHTML = "";
      }
    }
  },
  computed: {
    tweetText() {
      return `#zksync_claim ${this.ticketHash}`;
    },
    cleanAddress() {
      return this.address.trim().toLowerCase();
    },
    ticketHash() {
      const address = this.cleanAddress;
      this.salt = Math.random().toString();

      const preimage = (String(address).trim() + String(this.salt).trim()).toLowerCase();
      
      const hash = crypto.createHash('sha256');
      hash.update(preimage);
      
      // 13 hex char numbers fit in a double
      const digest = hash.digest('hex').slice(0, 13);
      return parseInt(digest, 16).toString().padStart(16, '0');
    },
    addressOk() {
      return /^0x([0-9a-fA-F]){40}$/.test(this.cleanAddress);
    }
  },
  async created() {
    this.address = '0x52312AD6f01657413b2eaE9287f6B9ADaD93D5FE';

    while (window.twttr == undefined) {
      await sleep(100);
    }

    this.ready = true;

    // It's not tweet but a mere click on the tweet button.
    // There's no way to know if the user actually tweeted.
    window.twttr.events.bind('tweet', async event => {
      const res = await axios.get(`/register_address/${this.cleanAddress}/${this.salt}`);
      console.log(res);
    });
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>
