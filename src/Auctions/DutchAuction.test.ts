import "reflect-metadata";
import { InMemorySigner, TestingAppChain } from "@proto-kit/sdk";
import {
  Poseidon,
  PrivateKey,
  UInt32,
  Encoding,
  UInt64,
  PublicKey,
} from "o1js";
import { NFTKey, NFT } from "../NFT";
import { DutchAuction, DutchAuctionModule } from "./DutchAuction";
import { log } from "@proto-kit/common";
import { ModuleQuery } from "@proto-kit/sequencer";
import { Balances } from "../Balances";
import { GlobalCounter } from "../GlobalCounter";

log.setLevel("ERROR");

describe("DutchAuctions", () => {
  let appChain: TestingAppChain<{
    DutchAuctionModule: typeof DutchAuctionModule;
    NFT: typeof NFT;
    GlobalCounter: typeof GlobalCounter;
    Balances: typeof Balances;
  }>;
  let alicePrivateKey: PrivateKey;
  let alice: PublicKey;
  let bobPrivateKey: PrivateKey;
  let bob: PublicKey;
  let balances: Balances;
  let balanceQuery: ModuleQuery<Balances>;
  let nfts: NFT;
  let nftQuery: ModuleQuery<NFT>;
  let auction: DutchAuctionModule;
  let inMemorySigner: InMemorySigner; //TODO remove later

  beforeAll(async () => {
    appChain = TestingAppChain.fromRuntime({
      modules: {
        DutchAuctionModule,
        NFT,
        GlobalCounter,
        Balances,
      },
      config: {
        DutchAuctionModule: {},
        NFT: {},
        GlobalCounter: {},
        Balances: {},
      },
    });
    await appChain.start();
    // TODO remove later
    inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);

    alicePrivateKey = PrivateKey.random();
    alice = alicePrivateKey.toPublicKey();
    bobPrivateKey = PrivateKey.random();
    bob = bobPrivateKey.toPublicKey();

    balances = appChain.runtime.resolve("Balances");
    balanceQuery = appChain.query.runtime.Balances;
    nfts = appChain.runtime.resolve("NFT");
    nftQuery = appChain.query.runtime.NFT;
    auction = appChain.runtime.resolve("DutchAuctionModule");

    // console.log("Alice: ", alice.toBase58());
    // console.log("Bob:   ", bob.toBase58());

    // Alice mints 1000 tokens
    appChain.setSigner(alicePrivateKey);
    inMemorySigner.config.signer = alicePrivateKey;
    let tx = await appChain.transaction(alice, () => {
      balances.setBalance(alice, UInt64.from(1000));
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();
  });

  it("should able to auction", async () => {
    // bob mints 1 nfts and sets up a auction
    const nftMetadata = Poseidon.hash(
      Encoding.stringToFields(
        JSON.stringify({
          name: "testNFT",
          uri: "...",
        })
      )
    );
    inMemorySigner.config.signer = bobPrivateKey; // appChain.setSigner(bobPrivateKey);
    let tx = await appChain.transaction(bob, () => {
      nfts.mint(bob, nftMetadata); // mints to himself
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    const nft0Key = NFTKey.from(bob, UInt32.from(0));
    let nft0 = await nftQuery.records.get(nft0Key);
    expect(nft0?.owner).toStrictEqual(bob); // bob is still owner
    expect(nft0?.locked.toBoolean()).toStrictEqual(false); // nft should be locked

    // bob starts an auction
    tx = await appChain.transaction(bob, () => {
      auction.start(nft0Key, UInt64.from(1000), UInt64.from(10), UInt64.zero);
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    let auction0 = await appChain.query.runtime.DutchAuctionModule.records.get(
      UInt64.from(0)
    );
    expect(auction0?.nftKey.collection.toBase58()).toBe(bob.toBase58());
    expect(auction0?.decayRate.toBigInt()).toBe(10n);
    expect(auction0?.ended.toBoolean()).toBe(false);

    // alice bids after 1 blocks
    inMemorySigner.config.signer = alicePrivateKey; // appChain.setSigner(alicePrivateKey);
    appChain.setSigner(alicePrivateKey);
    tx = await appChain.transaction(alice, () => {
      auction.bid(UInt64.from(0));
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    nft0 = await nftQuery.records.get(nft0Key);
    expect(nft0?.owner).toStrictEqual(alice); // now Alice owns it
    // bob should receive 990
    let bobBalance = await balanceQuery.balances.get(bob);
    expect(bobBalance?.toBigInt()).toBe(990n);

    auction0 = await appChain.query.runtime.DutchAuctionModule.records.get(
      UInt64.from(0)
    );
    expect(auction0?.winner.toBase58()).toBe(alice.toBase58());
    expect(auction0?.ended.toBoolean()).toBe(true); // should end
  });
});
