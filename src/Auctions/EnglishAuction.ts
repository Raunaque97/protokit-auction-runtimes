import { runtimeMethod, RuntimeModule, state } from "@proto-kit/module";
import { StateMap, State } from "@proto-kit/protocol";
import assert from "assert";
import { Bool, Field, PublicKey, Struct, UInt64 } from "snarkyjs";
import { inject } from "tsyringe";
import { NFT, NFTKey } from "../NFT";

export class Bids extends Struct({
  bidder: PublicKey,
  price: UInt64,
}) {}

export class EnglishAuction extends RuntimeModule<unknown> {
  @state() public askPrices = StateMap.from<NFTKey, UInt64>(NFTKey, UInt64);
  @state() public maxBids = StateMap.from<NFTKey, Bids>(NFTKey, Bids);

  public constructor(@inject("NFT") public nft: NFT) {
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
  // @runtimeMethod()
  // public buyItem(nftKey: NFTKey) {}

  @runtimeMethod()
  public placeBid(nftKey: NFTKey, bid: UInt64) {
    const currentBid = new Bids({
      bidder: this.transaction.sender,
      price: bid,
    });
    const maxBid = this.maxBids.get(nftKey).value;
    assert(
      currentBid.price.assertGreaterThan(maxBid.price),
      "Bid must be higher than previous bid"
    );
    this.maxBids.set(nftKey, currentBid);
    // TODO lock bidders amount
  }

  @runtimeMethod()
  public acceptBid(nftKey: NFTKey) {
    const maxBid = this.maxBids.get(nftKey).value;
    this.nft.transfer(maxBid.bidder, nftKey);
    this.nft.unlock(nftKey);
    // only owner
    this.nft.assertAddressOwner(nftKey, this.transaction.sender);
    // assert bid exists
    maxBid.bidder.isEmpty().assertFalse();
    // TODO transfer the lock token amount to seller

    // reset maxBid & askPrice
    this.maxBids.set(
      nftKey,
      new Bids({ bidder: PublicKey.empty(), price: UInt64.zero })
    );
    this.askPrices.set(nftKey, UInt64.zero);
  }
}
