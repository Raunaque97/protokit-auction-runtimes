import {
  runtimeMethod,
  runtimeModule,
  RuntimeModule,
  state,
} from "@proto-kit/module";
import { StateMap } from "@proto-kit/protocol";
import assert from "assert";
import {
  Bool,
  Encoding,
  Poseidon,
  Provable,
  PublicKey,
  Struct,
  UInt64,
} from "o1js";
import { inject } from "tsyringe";
import { NFT, NFTKey } from "../NFT";
import { Balances } from "../Balances";
import { AuctionModule, BaseAuctionData } from "./Auction";

export class Bids extends Struct({
  bidder: PublicKey,
  price: UInt64,
}) {}

export class EnglishAuction extends Struct({
  ...BaseAuctionData,
  startTime: UInt64,
  endTime: UInt64,
  maxBid: Bids,
}) {}

@runtimeModule()
export class EnglishAuctionModule extends AuctionModule<EnglishAuction> {
  public readonly ADDRESS = PublicKey.from({
    x: Poseidon.hash(Encoding.stringToFields("EnglishAuction")),
    isOdd: Bool(false),
  });
  @state() public auctionIds = StateMap.from<NFTKey, UInt64>(NFTKey, UInt64);

  public constructor(
    @inject("NFT") public nft: NFT,
    @inject("Balances") public balance: Balances
  ) {
    super(nft);
    this.records = StateMap.from<UInt64, EnglishAuction>(
      UInt64,
      EnglishAuction
    );
  }

  @runtimeMethod()
  public start(nftKey: NFTKey, endTime: UInt64) {
    const auction = new EnglishAuction({
      nftKey,
      creator: this.transaction.sender,
      winner: PublicKey.empty(),
      ended: Bool(false),
      startTime: this.network.block.height,
      endTime: endTime,
      maxBid: new Bids({ bidder: this.transaction.sender, price: UInt64.zero }),
    });
    this.auctionIds.set(nftKey, this.createAuction(auction));
  }

  @runtimeMethod()
  public placeBid(nftKey: NFTKey, bid: UInt64) {
    const auctionId = this.auctionIds.get(nftKey);
    assert(auctionId.isSome, "no auctions exists");
    const auction = this.records.get(auctionId.value).value;
    const currentBid = new Bids({
      bidder: this.transaction.sender,
      price: bid,
    });
    assert(
      currentBid.price.greaterThan(auction.maxBid.price),
      "Bid must be higher than previous bid"
    );
    assert(
      auction.endTime
        .greaterThan(this.network.block.height)
        .and(auction.ended.not()),
      "Auction has ended"
    );
    // lock bidders amount
    this.balance.transferFrom(this.transaction.sender, this.ADDRESS, bid);
    // we return the earlier bidders locked amount
    this.balance.transferFrom(
      this.ADDRESS,
      auction.maxBid.bidder,
      auction.maxBid.price
    );
    // update maxBids
    this.records.set(auctionId.value, { ...auction, maxBid: currentBid });
  }

  /**
   * Anyone can call this after auction endTime
   * maxBidder gets the nft and
   * auction creator gets the bid
   * @param nftKey
   */
  @runtimeMethod()
  public end(nftKey: NFTKey) {
    const auctionId = this.auctionIds.get(nftKey);
    assert(auctionId.isSome, "no auctions exists");
    const auction = this.records.get(auctionId.value).value;
    assert(
      auction.endTime
        .lessThan(this.network.block.height)
        .and(auction.ended.not()),
      "Wait till auction ends"
    );
    // transfer the locked token amount to seller or auction creator
    this.balance.transferFrom(
      this.ADDRESS,
      auction.creator,
      auction.maxBid.price
    );
    // end auction
    this.endAuction(auctionId.value, auction.maxBid.bidder);
  }
}
