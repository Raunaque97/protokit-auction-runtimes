import "reflect-metadata";
import { InMemorySigner, ModuleQuery, TestingAppChain } from "@proto-kit/sdk";
import {
  Poseidon,
  PrivateKey,
  UInt32,
  Encoding,
  UInt64,
  PublicKey,
} from "o1js";
import { NFTKey, NFT } from "../NFT";
import { EnglishAuction } from "./EnglishAuction";
import { log } from "@proto-kit/common";
import { Balances } from "../Balances";

log.setLevel("ERROR");

describe("EnglishAuction", () => {
  let appChain: TestingAppChain<{
    EnglishAuction: typeof EnglishAuction;
    NFT: typeof NFT;
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
  let auction: EnglishAuction;
  let auctionQuery: ModuleQuery<EnglishAuction>;
  let inMemorySigner: InMemorySigner; //TODO remove later

  beforeEach(async () => {
    appChain = TestingAppChain.fromRuntime({
      modules: {
        EnglishAuction,
        NFT,
        Balances,
      },
      config: {
        EnglishAuction: {},
        NFT: {},
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
    auction = appChain.runtime.resolve("EnglishAuction");
    auctionQuery = appChain.query.runtime.EnglishAuction;

    console.log("Alice: ", alice.toBase58());
    console.log("Bob:   ", bob.toBase58());

    // Alice mints 1000 tokens
    appChain.setSigner(alicePrivateKey);
    inMemorySigner.config.signer = alicePrivateKey;
    let tx = appChain.transaction(alice, () => {
      balances.setBalance(alice, UInt64.from(1000));
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();
  });

  it("should able to auction", async () => {
    // minter mints 1 nfts and sets up a auction
    const nftMetadata = Poseidon.hash(
      Encoding.stringToFields(
        JSON.stringify({
          name: "testNFT",
          uri: "...",
        })
      )
    );
    const minterPrivateKey = PrivateKey.random();
    const minter = minterPrivateKey.toPublicKey();
    inMemorySigner.config.signer = minterPrivateKey; // appChain.setSigner(minterPrivateKey);

    let tx = appChain.transaction(minter, () => {
      nfts.mint(minter, nftMetadata); // mints to himself
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    const nft0Key = NFTKey.from(minter, UInt32.from(0));
    let nft0 = await appChain.query.runtime.NFT.records.get(nft0Key);
    expect(nft0?.owner).toStrictEqual(minter); // minter is still owner
    expect(nft0?.locked.toBoolean()).toStrictEqual(false); // nft should not be locked

    // minter lists for auction
    tx = appChain.transaction(minter, () => {
      auction.listItem(nft0Key, UInt64.from(1000));
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    nft0 = await appChain.query.runtime.NFT.records.get(nft0Key);
    expect(nft0?.owner).toStrictEqual(minter); // minter should still be owner
    expect(nft0?.locked.toBoolean()).toStrictEqual(true); // nft should be locked now

    // alice bids after 1 blocks
    inMemorySigner.config.signer = alicePrivateKey; // appChain.setSigner(alicePrivateKey);

    tx = appChain.transaction(alice, () => {
      auction.placeBid(nft0Key, UInt64.from(500));
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    let aliceBalance = await balanceQuery.balances.get(alice);
    expect(aliceBalance?.toBigInt()).toBe(500n);
    let minterBalance = await balanceQuery.balances.get(minter);
    expect(minterBalance?.toBigInt()).toBe(undefined);

    // minter accepts bid
    inMemorySigner.config.signer = minterPrivateKey; // appChain.setSigner(minterPrivateKey);

    tx = appChain.transaction(minter, () => {
      auction.acceptBid(nft0Key);
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    minterBalance = await balanceQuery.balances.get(minter);
    expect(minterBalance?.toBigInt()).toBe(500n);

    nft0 = await appChain.query.runtime.NFT.records.get(nft0Key);
    expect(nft0?.owner).toStrictEqual(alice); // alice is the new owner
    expect(nft0?.locked.toBoolean()).toStrictEqual(false); // nft should be unlocked
  });
});
