import {
  runtimeMethod,
  runtimeModule,
  RuntimeModule,
  state,
} from "@proto-kit/module";
import { StateMap, State } from "@proto-kit/protocol";
import assert from "assert";
import { Bool, Field, Poseidon, PublicKey, Struct, UInt64 } from "o1js";
import { inject } from "tsyringe";
import { NFT, NFTKey } from "../NFT";
import { Balances } from "../Balances";

export class Bids extends Struct({
  bidder: PublicKey,
  price: UInt64,
}) {}

@runtimeModule()
export class EnglishAuction extends RuntimeModule<unknown> {
  @state() public askPrices = StateMap.from<NFTKey, UInt64>(NFTKey, UInt64);
  @state() public maxBids = StateMap.from<NFTKey, Bids>(NFTKey, Bids);

  public readonly ADDRESS = PublicKey.from({
    x: Poseidon.hash([Field(1), Field(42)]),
    isOdd: Bool(false),
  });

  public constructor(
    @inject("NFT") public nft: NFT,
    @inject("Balances") public balance: Balances
  ) {
    super();
  }

  @runtimeMethod()
  public listItem(nftKey: NFTKey, askPrice: UInt64) {
    // check owner
    this.nft.assertAddressOwner(nftKey, this.transaction.sender);
    // assert not locked
    this.nft.assertUnLocked(nftKey);

    this.askPrices.set(nftKey, askPrice);
    // lock nft
    this.nft.lock(nftKey);
  }

  @runtimeMethod()
  public placeBid(nftKey: NFTKey, bid: UInt64) {
    const currentBid = new Bids({
      bidder: this.transaction.sender,
      price: bid,
    });
    const maxBid = this.maxBids.get(nftKey).value;
    assert(
      currentBid.price.greaterThan(maxBid.price),
      "Bid must be higher than previous bid"
    );
    // lock bidders amount
    this.balance.transferFrom(this.transaction.sender, this.ADDRESS, bid);
    // we return the earlier bidders locked amount
    this.balance.transferFrom(this.ADDRESS, maxBid.bidder, maxBid.price);
    // update maxBids
    this.maxBids.set(nftKey, currentBid);
  }

  @runtimeMethod()
  public acceptBid(nftKey: NFTKey) {
    // only owner
    this.nft.assertAddressOwner(nftKey, this.transaction.sender);
    // assert bid exists
    assert(this.maxBids.get(nftKey).isSome, "no bids exists");
    const maxBid = this.maxBids.get(nftKey).value;
    assert(maxBid.bidder.isEmpty().not(), "no bid exists/already accepted");

    // transfer the locked token amount to seller
    this.balance.transferFrom(
      this.ADDRESS,
      this.transaction.sender,
      maxBid.price
    );

    // transfer nft to max bidder
    this.nft.transfer(maxBid.bidder, nftKey);
    this.nft.unlock(nftKey);
    // reset maxBid & askPrice TODO update to remove
    this.maxBids.set(
      nftKey,
      new Bids({ bidder: PublicKey.empty(), price: UInt64.zero })
    );
    this.askPrices.set(nftKey, UInt64.zero);
  }
}
