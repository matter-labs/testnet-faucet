# Twitter integration

We have a button, something like "Share in Twitter", which posts:

> I'm playing with Matter Labs. keccak256 of my salted eth address is 0xdeadbeef

Since it's done from our website, we can send a request, with url of the tweet.
We then won't have to scan through all of the tweets, finding those looking like of our clients.

```html
<a href="https://twitter.com/share?ref_src=twsrc%5Etfw" class="twitter-share-button" data-text="I&#39;m playing with Matter Labs. keccak256 of my salted eth address is 0xdeadbeef" data-lang="en" data-show-count="false">Tweet</a><script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
```

You can't know the twitter url, or id, or anything from when the guy clicks `tweet` button.

You also can't know when person really tweets, only when clicks "tweet" button.


## Real-time scanning

[post-statuses-filter](https://developer.twitter.com/en/docs/tweets/filter-realtime/api-reference/post-statuses-filter) Requires authentication (user context only).

There's [real-time subscription endpoint](https://developer.twitter.com/en/docs/tweets/filter-realtime/guides/connecting), and it's somewhat hard to connect.

> Pass the -N/--no-buffer flag to curl.

https://github.com/draftbit/twitter-lite#streams


# Usage

http://localhost:2880/add/0xa61464658afeaf65cccaafd3a512b69a83b77618
http://localhost:2880/money/https%3A%2F%2Ftwitter.com%2FEquatorialStar%2Fstatus%2F1262576604682878982

https://twitter.com/fe_city_boy/status/1262719443576262657
https://twitter.com/EquatorialStar/status/1262959985677516801
