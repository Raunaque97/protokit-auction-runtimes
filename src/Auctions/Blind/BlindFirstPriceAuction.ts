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
import { NFT, NFTKey } from "../../NFT";
import { AuctionModule, BaseAuctionData } from "../Auction";
import { PrivateToken } from "../../PrivateToken/PrivateToken";
import { RevealBidProof, SealedBidProof } from "./Proofs";
import { GlobalCounter } from "../../GlobalCounter";

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
  @state() public bidHashes = StateMap.from<Field, Bool>(Field, Bool);

  public constructor(
    @inject("NFT") public nft: NFT,
    @inject("GlobalCounter") public counter: GlobalCounter,
    @inject("PrivateToken") public privateToken: PrivateToken
  ) {
    super(nft, counter);
    this.records = StateMap.from<UInt64, BlindFirstPriceAuction>(
      UInt64,
      BlindFirstPriceAuction
    );
  }

  @runtimeMethod()
  public start(
    nftKey: NFTKey,
    biddingWindow: UInt64,
    revealWindow: UInt64,
    minPrice: UInt64
  ) {
    const auction = new BlindFirstPriceAuction({
      nftKey,
      creator: this.transaction.sender,
      winner: PublicKey.empty(),
      ended: Bool(false),
      startTime: this.network.block.height,
      revealTime: this.network.block.height.add(biddingWindow),
      endTime: this.network.block.height.add(biddingWindow).add(revealWindow),
      maxBid: new Bids({ bidder: this.transaction.sender, price: minPrice }),
    });
    this.privateToken.balance.transferFrom(
      this.transaction.sender,
      this.privateToken.DEPOSIT_ADDRESS,
      minPrice
    );
    this.auctionIds.set(nftKey, this.createAuction(auction));
  }

  /**
   * place bid before reveal Time.
   * bidHash = H(auctionId, value, salt)
   * @param nftKey
   * @param sealedBidProof
   */
  @runtimeMethod()
  public placeSealedBid(nftKey: NFTKey, sealedBidProof: SealedBidProof) {
    const auctionId = this.auctionIds.get(nftKey);
    assert(auctionId.isSome, "no auctions exists");
    const auction = this.records.get(auctionId.value).value;
    assert(
      auction.revealTime.greaterThanOrEqual(this.network.block.height),
      "bidding ended"
    );
    sealedBidProof.verify();
    const sealedBidProofOutput = sealedBidProof.publicOutput;
    const currentBalance = this.privateToken.ledger.get(
      sealedBidProofOutput.owner
    ).value;
    assert(
      sealedBidProofOutput.currentBalance.equals(currentBalance),
      "Proven encrypted balance does not match current known encrypted balance"
    );
    assert(sealedBidProofOutput.to.equals(this.ADDRESS), "wrong Auction");
    assert(
      this.bidHashes.get(sealedBidProofOutput.bidHash).isSome.not(),
      "bidHash already used"
    );

    //Update the encrypted balance
    this.privateToken.ledger.set(
      sealedBidProofOutput.owner,
      sealedBidProofOutput.resultingBalance
    );
    // update bidHashes
    this.bidHashes.set(sealedBidProofOutput.bidHash, Bool(true));
  }

  /**
   * Reveal Bid during reveal window
   * Lose bid amount if not revealed
   * Also refunds the lost bidders, a equivalent amount in normal tokens.
   * @param nftKey
   */
  @runtimeMethod()
  public revealBid(revealBidProof: RevealBidProof) {
    revealBidProof.verify();
    const revealedBid = revealBidProof.publicOutput;
    const auctionId = revealedBid.auctionId;
    const auction = this.records.get(auctionId).value;
    assert(
      auction.revealTime
        .lessThan(this.network.block.height)
        .and(auction.endTime.greaterThanOrEqual(this.network.block.height)),
      "outside reveal window"
    );
    assert(
      this.bidHashes.get(revealedBid.bidHash).value,
      "BidHash does not exist"
    );

    // return locked funds to prev maxBidder if we have a new maxBidder
    // else to the current bidder
    const refund = Provable.if(
      revealedBid.amount.greaterThan(auction.maxBid.price),
      auction.maxBid.price,
      revealedBid.amount
    );
    const refundee = Provable.if(
      revealedBid.amount.greaterThan(auction.maxBid.price),
      auction.maxBid.bidder,
      revealedBid.bidder
    );
    this.privateToken.unlockBalance(refundee, refund);

    // if(revealedBid.amount > maxBid) update maxBid
    const newMaxBid: Bids = new Bids({
      bidder: Provable.if(
        revealedBid.amount.greaterThan(auction.maxBid.price),
        revealedBid.bidder,
        auction.maxBid.bidder
      ),
      price: Provable.if(
        revealedBid.amount.greaterThan(auction.maxBid.price),
        revealedBid.amount,
        auction.maxBid.price
      ),
    });
    this.records.set(auctionId, { ...auction, maxBid: newMaxBid });
    this.bidHashes.set(revealedBid.bidHash, Bool(false));
  }

  /**
   * ends the auction, called after `endTime`
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
