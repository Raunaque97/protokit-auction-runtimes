import { runtimeMethod, RuntimeModule, state } from "@proto-kit/module";
import assert from "assert";
import { Bool, PublicKey, Struct, UInt64 } from "snarkyjs";
import { inject } from "tsyringe";
import { NFT, NFTKey } from "../NFT";
import { StateMap, State } from "@proto-kit/protocol";

export const BaseAuctionData = {
  nftKey: NFTKey,
  creator: PublicKey,
  winner: PublicKey, // default value empty
  ended: Bool,
};

export class Auction extends Struct(BaseAuctionData) {}

export abstract class AuctionModule<
  A extends Auction
> extends RuntimeModule<unknown> {
  @state() public records!: StateMap<UInt64, A>;
  @state() public counter = State.from<UInt64>(UInt64);

  public constructor(@inject("NFT") public nft: NFT) {
    super();
  }

  /**
   * updates record, locks nft and assets
   * @param auction
   */
  public createAuction(auction: A) {
    this.records.set(this.counter.get().value, auction);
    this.counter.set(this.counter.get().value.add(1));
    const nftToAuction = this.nft.records.get(auction.nftKey).value;
    assert(
      this.transaction.sender.equals(nftToAuction.owner),
      "You are not the owner"
    );
    // check if the nft is unlocked
    assert(nftToAuction.locked.not(), "NFT is locked");
    // lock the nft
    // this.nft.lock(nftKey); // TODO test both
    nftToAuction.lock();
  }

  /**
   * Ends auction, transfer nft to winner and unlocks it
   * @param id
   * @param winner
   */
  public endAuction(id: UInt64, winner: PublicKey) {
    winner.isEmpty().assertFalse("Winner cannot be empty");
    const auction = this.records.get(id).value;
    auction.ended = Bool(true);
    auction.winner = winner;
    this.records.set(id, auction); // TODO check if this is needed
    const auctionedNFT = this.nft.records.get(auction.nftKey).value;
    auctionedNFT.owner = winner;
    auctionedNFT.unlock();
  }
}
