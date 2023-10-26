import {
  runtimeMethod,
  runtimeModule,
  RuntimeModule,
  state,
} from "@proto-kit/module";
import assert from "assert";
import { Bool, Provable, PublicKey, Struct, UInt64 } from "o1js";
import { inject } from "tsyringe";
import { NFT, NFTKey } from "../NFT";
import { StateMap } from "@proto-kit/protocol";
import { Auction, AuctionModule, BaseAuctionData } from "./Auction";

export class DutchAuction extends Struct({
  ...BaseAuctionData,
  startPrice: UInt64,
  minPrice: UInt64,
  decayRate: UInt64,
  startTime: UInt64,
}) {}
/**
 * In Dutch Auction aka descending price auction,
 * starts with a high price,
 * incrementally lowering the price until someone places a bid.
 */
@runtimeModule()
export class DutchAuctionModule extends AuctionModule<DutchAuction> {
  public constructor(@inject("NFT") public nft: NFT) {
    super(nft);
    this.records = StateMap.from<UInt64, DutchAuction>(UInt64, DutchAuction);
  }

  @runtimeMethod()
  public start(
    nftKey: NFTKey,
    startPrice: UInt64,
    decayRate: UInt64,
    minPrice: UInt64 = UInt64.zero
  ) {
    const auction = new DutchAuction({
      nftKey,
      creator: this.transaction.sender,
      winner: PublicKey.empty(),
      ended: Bool(false),
      startPrice,
      startTime: this.network.block.height,
      decayRate,
      minPrice,
    });
    this.createAuction(auction);
  }

  /**
   * The first bid ends the auction
   * @param auctionId
   */
  @runtimeMethod()
  public bid(auctionId: UInt64) {
    const auction = this.records.get(auctionId).value;
    const decay = this.network.block.height
      .sub(auction.startTime)
      .mul(auction.decayRate);
    const finalPrice = Provable.if(
      decay.greaterThan(auction.startPrice.sub(auction.minPrice)),
      auction.minPrice,
      auction.startPrice.sub(decay)
    );
    // console.log("Final prize", finalPrice.toString());
    // TODO do token transfer
    this.endAuction(auctionId, this.transaction.sender);
  }
}
