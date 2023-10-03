import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import { Poseidon, PrivateKey, UInt32, Encoding, UInt64 } from "snarkyjs";
import { NFTKey, NFT } from "../NFT";
import { DutchAuctionModule } from "./DutchAuction";
import { log } from "@proto-kit/common";

log.setLevel("ERROR");

describe("DutchAuctions", () => {
  it("should able to auction", async () => {
    const appChain = TestingAppChain.fromRuntime({
      modules: {
        DutchAuctionModule,
        NFT,
      },
      config: {
        DutchAuctionModule: {},
        NFT: {},
      },
    });

    await appChain.start();

    const alicePrivateKey = PrivateKey.random();
    const alice = alicePrivateKey.toPublicKey();

    const minterPrivateKey = PrivateKey.random();
    const minter = minterPrivateKey.toPublicKey();
    const nft = appChain.runtime.resolve("NFT");
    const auctions = appChain.runtime.resolve("DutchAuctionModule");

    // minter mints 1 nfts and sets up a auction
    const nftMetadata = Poseidon.hash(
      Encoding.stringToFields(
        JSON.stringify({
          name: "testNFT",
          uri: "...",
        })
      )
    );
    appChain.setSigner(minterPrivateKey);
    let tx = appChain.transaction(minter, () => {
      nft.mint(minter, nftMetadata); // mints to himself
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    const nft0Key = NFTKey.from(minter, UInt32.from(0));
    let nft0 = await appChain.query.runtime.NFT.records.get(nft0Key);
    expect(nft0?.owner).toStrictEqual(minter); // minter is still owner
    expect(nft0?.locked.toBoolean()).toStrictEqual(false); // nft should be locked

    tx = appChain.transaction(minter, () => {
      auctions.start(nft0Key, UInt64.from(1000), UInt64.from(10), UInt64.zero);
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    // alice bids after 1 blocks
    appChain.setSigner(alicePrivateKey);
    tx = appChain.transaction(minter, () => {
      auctions.bid(UInt64.from(0));
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    // nft0 = await appChain.query.runtime.NFT.records.get(nft0Key);
    // expect(nft0?.owner).toStrictEqual(alice); // now Alice owns it
  });
});
