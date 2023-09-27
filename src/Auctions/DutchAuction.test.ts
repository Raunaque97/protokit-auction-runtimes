import { TestingAppChain } from "@proto-kit/sdk";
import { Poseidon, PrivateKey, UInt32, Encoding } from "snarkyjs";
import { NFTKey, NFT } from "../NFT";
import { log } from "@proto-kit/common";

log.setLevel("silent");

describe("NFTs", () => {
  it("should able to transfer", async () => {
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
      nft.mint(minter, nftMetadata);
    });
    await tx1.sign();
    await tx1.send();

    const block1 = await appChain.produceBlock();

    const nft1key = NFTKey.from(minter, UInt32.from(0));
    const nft1 = await appChain.query.runtime.NFT.records.get(nft1key);

    expect(nft1?.owner).toStrictEqual(minter);
    expect(block1?.txs[0].status).toBe(true);
  });
});
