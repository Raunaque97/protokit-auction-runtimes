import { runtimeMethod, runtimeModule, state } from "@proto-kit/module";
import { StateMap, assert } from "@proto-kit/protocol";
import {
  Bool,
  Encoding,
  Field,
  Poseidon,
  Provable,
  PublicKey,
  Struct,
  UInt64,
} from "o1js";
import { inject } from "tsyringe";
import { NFT, NFTKey } from "../NFT";
import { AuctionModule, BaseAuctionData } from "./Auction";
import { PrivateToken } from "../PrivateToken/PrivateToken";

export class Bids extends Struct({
  bidder: PublicKey,
  price: UInt64,
}) {}

export class BlindFirstPriceAuction extends Struct({
  ...BaseAuctionData,
  startTime: UInt64,
  revealTime: UInt64,
  endTime: UInt64,
  maxBid: Bids,
}) {}

@runtimeModule()
export class BlindFirstPriceAuctionModule extends AuctionModule<BlindFirstPriceAuction> {
  public readonly ADDRESS = PublicKey.from({
    x: Poseidon.hash(Encoding.stringToFields("BlindFirstPriceAuction")),
    isOdd: Bool(false),
  });
  @state() public auctionIds = StateMap.from<NFTKey, UInt64>(NFTKey, UInt64);
  @state() public bidHashs = StateMap.from<Field, Bool>(Field, Bool);

  public constructor(
    @inject("NFT") public nft: NFT,
    @inject("PrivateToken") public privateToken: PrivateToken
  ) {
    super(nft);
    this.records = StateMap.from<UInt64, BlindFirstPriceAuction>(
      UInt64,
      BlindFirstPriceAuction
    );
  }

  @runtimeMethod()
  public start(
    nftKey: NFTKey,
    endTime: UInt64,
    revealTime: UInt64,
    minPrice: UInt64
  ) {
    assert(revealTime.lessThan(endTime), "check timings");
    const auction = new BlindFirstPriceAuction({
      nftKey,
      creator: this.transaction.sender,
      winner: PublicKey.empty(),
      ended: Bool(false),
      startTime: this.network.block.height,
      revealTime: revealTime,
      endTime: endTime,
      maxBid: new Bids({ bidder: this.transaction.sender, price: minPrice }),
    });
    this.auctionIds.set(nftKey, this.createAuction(auction));
  }

  /**
   * place bid before reveal Time.
   * @param nftKey
   * @param bidHashProof
   */
  @runtimeMethod()
  public placeSealedBid(nftKey: NFTKey, bidHashProof: Field) {
    const auctionId = this.auctionIds.get(nftKey);
    assert(auctionId.isSome, "no auctions exists");
    assert(this.bidHashs.get(bidHashProof).isSome.not(), "bid Hash used");
    const auction = this.records.get(auctionId.value).value;
    assert(
      auction.revealTime.greaterThanOrEqual(this.network.block.height),
      "bidding ended"
    );
    // TODO Prove funds are locked
    // this.privateToken.claims()

    this.bidHashs.set(bidHashProof, Bool(true));
  }

  /**
   * Reveal Bid during reveal window
   * Lose bid amount if not revealed
   * Also refunds the lost bidders, a equivalent amount in normal tokens.
   * @param nftKey
   */
  @runtimeMethod()
  public revealBid(nftKey: NFTKey, revealBidProof: Field, revealBid: UInt64) {
    const auctionId = this.auctionIds.get(nftKey);
    assert(auctionId.isSome, "no auctions exists");
    const auction = this.records.get(auctionId.value).value;
    assert(
      auction.revealTime
        .lessThan(this.network.block.height)
        .and(auction.endTime.greaterThanOrEqual(this.network.block.height)),
      "outside reveal window"
    );
    // TODO verify revealBidProof, verify txn sender

    // return locked funds to prev maxBidder if we have a new maxBidder
    // else to the transaction sender
    const refund = Provable.if(
      revealBid.greaterThan(auction.maxBid.price),
      auction.maxBid.price,
      revealBid
    );
    const refundee = Provable.if(
      revealBid.greaterThan(auction.maxBid.price),
      auction.maxBid.bidder,
      this.transaction.sender
    );
    this.privateToken.unlockBalance(refundee, refund);

    // if(revealBid > maxBid) update maxbid
    auction.maxBid.bidder = Provable.if(
      revealBid.greaterThan(auction.maxBid.price),
      this.transaction.sender,
      auction.maxBid.bidder
    );
    auction.maxBid.price = Provable.if(
      revealBid.greaterThan(auction.maxBid.price),
      revealBid,
      auction.maxBid.price
    );
  }

  /**
   * ends the auction
   * max Bidder gets the nft and
   * auction creator gets the max bid amount
   * @param nftKey
   */
  @runtimeMethod()
  public settle(nftKey: NFTKey) {
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
    this.privateToken.unlockBalance(auction.creator, auction.maxBid.price);

    this.endAuction(auctionId.value, auction.maxBid.bidder);
  }
}
