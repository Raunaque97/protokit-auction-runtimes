import { runtimeModule, RuntimeModule, state } from "@proto-kit/module";
import assert from "assert";
import { Bool, PublicKey, Struct, UInt64 } from "o1js";
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
> extends RuntimeModule<{}> {
  @state() public records!: StateMap<UInt64, A>;
  @state() public counter = State.from<UInt64>(UInt64);

  public constructor(@inject("NFT") public nft: NFT) {
    super();
  }

  /**
   * checks owner, updates record, locks nft, increments counter
   * @param auction
   */
  public createAuction(auction: A): UInt64 {
    this.records.set(this.counter.get().value, auction);
    this.counter.set(this.counter.get().value.add(1));

    const nftKey = auction.nftKey;
    console.log("n", this.nft.records.get(nftKey).isSome.toBoolean());
    assert(this.nft.records.get(nftKey).isSome, "nft does not exists");
    this.nft.assertAddressOwner(nftKey, this.transaction.sender);
    // check if the nft is unlocked
    this.nft.assertUnLocked(auction.nftKey);

    // lock the nft
    this.nft.lock(auction.nftKey);
    return this.counter.get().value.sub(UInt64.one);
  }

  /**
   * Ends auction, transfer nft to winner and unlocks it
   * @param id
   * @param winner
   */
  public endAuction(id: UInt64, winner: PublicKey) {
    assert(winner.isEmpty().not(), "Winner cannot be empty");
    const auction = this.records.get(id).value;
    this.records.set(id, { ...auction, ended: Bool(true), winner }); // TODO check if this is needed
    // transfer the nft to new owner
    this.nft.transfer(winner, auction.nftKey);
    // unlock the nft
    this.nft.unlock(auction.nftKey);
  }
}
