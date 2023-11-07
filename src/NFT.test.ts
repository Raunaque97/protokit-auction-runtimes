import { TestingAppChain } from "@proto-kit/sdk";
import { Poseidon, PrivateKey, UInt32, Encoding } from "o1js";
import { NFTKey, NFT } from "./NFT";
import { log } from "@proto-kit/common";

log.setLevel("ERROR");

describe("NFT", () => {
  it("should able to mint & transfer", async () => {
    const appChain = TestingAppChain.fromRuntime({
      modules: {
        NFT,
      },
      config: {
        NFT: {},
      },
    });

    await appChain.start();

    const alicePrivateKey = PrivateKey.random();
    const alice = alicePrivateKey.toPublicKey();

    const bobPrivateKey = PrivateKey.random();
    const bob = bobPrivateKey.toPublicKey();

    const minterPrivateKey = PrivateKey.random();
    const minter = minterPrivateKey.toPublicKey();
    const nft = appChain.runtime.resolve("NFT");

    // minter mints 2 nfts
    const nftMetadata = Poseidon.hash(
      Encoding.stringToFields(
        JSON.stringify({
          name: "testNFT",
          uri: "...",
        })
      )
    );
    appChain.setSigner(minterPrivateKey);
    const tx1 = appChain.transaction(minter, () => {
      nft.mint(minter, nftMetadata); // mints to himself
    });
    await tx1.sign();
    await tx1.send();
    let block = await appChain.produceBlock();
    expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);

    const tx2 = appChain.transaction(minter, () => {
      nft.mint(alice, nftMetadata); // mints to Alice
    });
    await tx2.sign();
    await tx2.send();
    await appChain.produceBlock();

    // minter transfers nft1 to bob
    const tx3 = appChain.transaction(minter, () => {
      // nft.transfer(bob, NFTKey.from(minter, UInt32.from(0))); // has no effect
      nft.transferSigned(bob, NFTKey.from(minter, UInt32.from(0)));
      // nft.mint(bob, nftMetadata);
    });
    await tx3.sign();
    await tx3.send();

    block = await appChain.produceBlock();
    expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);

    const nft1key = NFTKey.from(minter, UInt32.from(0));
    const nft2key = NFTKey.from(minter, UInt32.from(1));
    let nft1 = await appChain.query.runtime.NFT.records.get(nft1key);
    let nft2 = await appChain.query.runtime.NFT.records.get(nft2key);
    expect(nft1?.owner).toStrictEqual(bob);
    expect(nft2?.owner).toStrictEqual(alice);

    // const block2 = await appChain.produceBlock();
    // expect(block2?.txs[0].status).toBe(true);
  }, 60_000);
});
