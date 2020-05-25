<template>
  <div v-if="ready">
    <div id="app">
      Your address:
      <input v-model="address" type="text" />
      <div id="tweetButtonPlaceholder" />
      Tweet url:
      <input v-model="tweetUrl" type="text" />
      <div><button @click="getMoney">Get money</button></div>
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
  }),
  methods: {
    async getMoney() {
      const res = await axios.get(`/validate_tweet/${encodeURIComponent(this.tweetUrl)}`);
      console.log(res);
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
      return `I prefer my crypto fast, like my lambos — @zksync early bird ticket ${this.ticketHash}`;
    },
    cleanAddress() {
      return this.address.trim().toLowerCase();
    },
    ticketHash() {
      const hash = crypto.createHash('sha256');
      hash.update(this.cleanAddress);
      const digest = hash.digest('hex');
      return `${digest.slice(0, 20)}`;
    },
    addressOk() {
      return /^0x([0-9a-fA-F]){40}$/.test(this.address.trim());
    }
  },
  async created() {
    while (window.twttr == undefined) {
      await sleep(100);
    }

    this.ready = true;

    // It's not tweet but a mere click on the tweet button.
    // There's no way to know if the user actually tweeted.
    window.twttr.events.bind('tweet', async event => {
      const res = await axios.get(`/register_address/${this.cleanAddress}`);
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
