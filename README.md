# Auction runtime-modules

Different Auctions & Utility runtimes designed to be used as Protokit runtimes (a zk-AppChain verified on mina).
Contains Runtimes for English Auctions, Dutch Auctions, and even **Sealed Bid Auctions** (aka Blind Auctions) with a PrivateToken Module which can be used to hide transfer amounts and place sealed Bids;

## Usage

`npm install @reevl/protokit-runtimes`

```js
import { EnglishAuction } from "@reevl/protokit-runtimes";
```

### PrivateToken runtime.

One can deposit normal tokens, wait for other transactions like tornado cash to increase anonymity. Then, withdraw to a private token system, where the user balances are hidden, but unlike Zcash transfer addresses are visible and the client Wallets only needs to store the private key no other data is necessary. Also, its account based so can be easily used with other runtimes/zkApps (for instance the BlindAuctions)

Check this diagram for details [Link](https://www.tldraw.com/s/v2_c_eY_wik38jtjTM9CCJEOFb?viewport=-622%2C2805%2C4334%2C2251&page=page%3ABJuSPrIoJ9Xqmd4QazqKn)
