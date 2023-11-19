import "reflect-metadata";
import {
  AppChainTransaction,
  InMemorySigner,
  TestingAppChain,
} from "@proto-kit/sdk";
import {
  Poseidon,
  PrivateKey,
  UInt32,
  Encoding,
  UInt64,
  PublicKey,
  Field,
  MerkleMap,
} from "o1js";
import { NFTKey, NFT } from "../../NFT";
import { BlindFirstPriceAuctionModule } from "./BlindFirstPriceAuction";
import { log } from "@proto-kit/common";
import { Balances } from "../../Balances";
import { ClaimKey, PrivateToken } from "../../PrivateToken/PrivateToken";
import {
  ClaimProof,
  DepositHashProof,
  DepositProof,
  EncryptedBalance,
  generateDepositHash,
} from "../../PrivateToken/Proofs";
import { Pickles } from "o1js/dist/node/snarky";
import { dummyBase64Proof } from "o1js/dist/node/lib/proof_system";
import { RevealBidProof, SealedBidProof, calcBidHash } from "./Proofs";
import { ModuleQuery } from "@proto-kit/sequencer";

log.setLevel("ERROR");

describe("BlindFirstPriceAuction", () => {
  let appChain: TestingAppChain<{
    BlindFirstPriceAuctionModule: typeof BlindFirstPriceAuctionModule;
    NFT: typeof NFT;
    Balances: typeof Balances;
    PrivateToken: typeof PrivateToken;
  }>;
  let alicePrivateKey: PrivateKey;
  let alice: PublicKey;
  let bobPrivateKey: PrivateKey;
  let bob: PublicKey;
  let balances: Balances;
  let balanceQuery: ModuleQuery<Balances>;
  let nfts: NFT;
  let nftQuery: ModuleQuery<NFT>;
  let blindAuctions: BlindFirstPriceAuctionModule;
  let auctionQuery: ModuleQuery<BlindFirstPriceAuctionModule>;
  let privateToken: PrivateToken;
  let privateTokenQuery: ModuleQuery<PrivateToken>;
  let inMemorySigner: InMemorySigner; //TODO remove later
  let dummy: any;

  beforeAll(async () => {
    appChain = TestingAppChain.fromRuntime({
      modules: {
        BlindFirstPriceAuctionModule,
        NFT,
        Balances,
        PrivateToken,
      },
      config: {
        BlindFirstPriceAuctionModule: {},
        NFT: {},
        Balances: {},
        PrivateToken: {},
      },
    });
    await appChain.start();
    // TODO remove later
    inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);

    [, dummy] = Pickles.proofOfBase64(await dummyBase64Proof(), 2);

    alicePrivateKey = PrivateKey.random();
    alice = alicePrivateKey.toPublicKey();
    bobPrivateKey = PrivateKey.random();
    bob = bobPrivateKey.toPublicKey();

    balances = appChain.runtime.resolve("Balances");
    balanceQuery = appChain.query.runtime.Balances;
    nfts = appChain.runtime.resolve("NFT");
    nftQuery = appChain.query.runtime.NFT;
    blindAuctions = appChain.runtime.resolve("BlindFirstPriceAuctionModule");
    auctionQuery = appChain.query.runtime.BlindFirstPriceAuctionModule;
    privateToken = appChain.runtime.resolve("PrivateToken");
    privateTokenQuery = appChain.query.runtime.PrivateToken;

    console.log("Alice: ", alice.toBase58());
    console.log("Bob:   ", bob.toBase58());

    // Alice, Bob mints 1000 tokens
    appChain.setSigner(alicePrivateKey);
    inMemorySigner.config.signer = alicePrivateKey;
    let tx = await appChain.transaction(alice, () => {
      balances.setBalance(alice, UInt64.from(1000));
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();
    tx = await appChain.transaction(alice, () => {
      balances.setBalance(bob, UInt64.from(1000));
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();
    // Alice, Bob converts their token to privateToken
    for (const key of [alicePrivateKey, bobPrivateKey]) {
      await convertTokenToPrivate(key, UInt64.from(1000));
    }
  }, 1000 * 60);

  it(
    "should able to auction",
    async () => {
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
      let tx = await appChain.transaction(minter, () => {
        nfts.mint(minter, nftMetadata); // mints to himself
      });
      await tx.sign();
      await tx.send();
      let block = await appChain.produceBlock();
      expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
      const nft0Key = NFTKey.from(minter, UInt32.from(0));
      // minter starts an Auction
      tx = await appChain.transaction(minter, () => {
        blindAuctions.start(
          nft0Key,
          UInt64.from(2),
          UInt64.from(2),
          UInt64.zero
        ); // bidding active for next 2 block
      });
      await tx.sign();
      await tx.send();
      block = await appChain.produceBlock();
      expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);

      let nft0 = await nftQuery.records.get(nft0Key);
      expect(nft0?.owner).toStrictEqual(minter); // minter should still be owner
      expect(nft0?.locked.toBoolean()).toStrictEqual(true); // nft should be locked now
      let auctionId = (await auctionQuery.auctionIds.get(nft0Key)) as UInt64;
      expect(auctionId?.toBigInt()).toBe(0n);
      let auction = await auctionQuery.records.get(auctionId!);
      // console.log(auction);
      expect(auction?.ended.toBoolean()).toBeFalsy();
      let aliceEncBalance = await privateTokenQuery.ledger.get(alice);
      let bobEncBalance = await privateTokenQuery.ledger.get(bob);
      expect(aliceEncBalance?.decrypt(alicePrivateKey).toBigInt()).toBe(1000n);
      expect(bobEncBalance?.decrypt(bobPrivateKey).toBigInt()).toBe(1000n);

      // Bidding Phase
      const aliceSalt = Field.random();
      {
        // Alice places a sealed bid with 500
        inMemorySigner.config.signer = alicePrivateKey; // appChain.setSigner(alicePrivateKey);
        const sealedBidProof = await createSealedBidProof(
          alicePrivateKey,
          auctionId,
          UInt64.from(500),
          aliceSalt
        );
        tx = await appChain.transaction(alice, async () => {
          blindAuctions.placeSealedBid(nft0Key, sealedBidProof);
        });
        await tx.sign();
        await tx.send();
        block = await appChain.produceBlock();
        expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
      }

      const bobSalt = Field.random();
      {
        // Bob places a sealed bid with 400
        inMemorySigner.config.signer = bobPrivateKey; // appChain.setSigner(bobPrivateKey);
        const sealedBidProof = await createSealedBidProof(
          bobPrivateKey,
          auctionId,
          UInt64.from(400),
          bobSalt
        );
        tx = await appChain.transaction(bob, async () => {
          blindAuctions.placeSealedBid(nft0Key, sealedBidProof);
        });
        await tx.sign();
        await tx.send();
        block = await appChain.produceBlock();
        expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
      }

      aliceEncBalance = await privateTokenQuery.ledger.get(alice);
      expect(aliceEncBalance?.decrypt(alicePrivateKey).toBigInt()).toBe(500n); // Alice's Balance reduced by 500
      bobEncBalance = await privateTokenQuery.ledger.get(bob);
      expect(bobEncBalance?.decrypt(bobPrivateKey).toBigInt()).toBe(600n); // Bob's by 400

      // Reveal Phase
      {
        const revealProof = await createRevealBidProof(
          bob,
          auctionId,
          UInt64.from(400),
          bobSalt
        );
        inMemorySigner.config.signer = bobPrivateKey; // appChain.setSigner(bobPrivateKey);
        tx = await appChain.transaction(bob, async () => {
          blindAuctions.revealBid(revealProof);
        });
        await tx.sign();
        await tx.send();
        block = await appChain.produceBlock();
        expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
      }
      {
        const revealProof = await createRevealBidProof(
          alice,
          auctionId,
          UInt64.from(500),
          aliceSalt
        );
        inMemorySigner.config.signer = alicePrivateKey; // appChain.setSigner(alicePrivateKey);
        tx = await appChain.transaction(alice, async () => {
          blindAuctions.revealBid(revealProof);
        });
        await tx.sign();
        await tx.send();
        block = await appChain.produceBlock();
        expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
      }

      aliceEncBalance = await privateTokenQuery.ledger.get(alice);
      expect(aliceEncBalance?.decrypt(alicePrivateKey).toBigInt()).toBe(500n); // Alice's Balance should remain same as she won
      let bobTokenBalance = await balanceQuery.balances.get(bob);
      expect(bobTokenBalance?.toBigInt()).toBe(400n); // Bob should get 400 back but in normal token form

      // auction settlement, anyone can call
      inMemorySigner.config.signer = alicePrivateKey;
      tx = await appChain.transaction(alice, () => {
        blindAuctions.settle(nft0Key);
      });
      await tx.sign();
      await tx.send();
      block = await appChain.produceBlock();
      expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);

      let minterBalance = await balanceQuery.balances.get(minter);
      expect(minterBalance?.toBigInt()).toBe(500n); // minter gets 500
      nft0 = await nftQuery.records.get(nft0Key);
      expect(nft0?.owner).toStrictEqual(alice); // alice is the new owner
      expect(nft0?.locked.toBoolean()).toStrictEqual(false); // nft should be unlocked
    },
    1000 * 60
  );

  // Helpers
  async function createSealedBidProof(
    bidderPvtKey: PrivateKey,
    auctionId: UInt64,
    amount: UInt64,
    salt: Field
  ): Promise<SealedBidProof> {
    // set signer
    appChain.setSigner(bidderPvtKey);
    // TODO remove later when `setSigner` is working
    const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
    inMemorySigner.config.signer = bidderPvtKey;

    // get bidder's balance
    const currentBalance = (await privateTokenQuery.ledger.get(
      bidderPvtKey.toPublicKey()
    )) as EncryptedBalance;
    if (currentBalance == undefined) {
      throw Error("have no balance");
    }
    // create dummy proof
    const decryptedBalance = currentBalance.decrypt(bidderPvtKey);
    const resultingBalance = EncryptedBalance.from(
      decryptedBalance.sub(amount),
      bidderPvtKey.toPublicKey()
    );
    return new SealedBidProof({
      proof: dummy,
      publicInput: undefined,
      publicOutput: {
        owner: bidderPvtKey.toPublicKey(),
        to: blindAuctions.ADDRESS,
        currentBalance: currentBalance,
        resultingBalance: resultingBalance,
        bidHash: calcBidHash(
          auctionId,
          amount,
          bidderPvtKey.toPublicKey(),
          salt
        ),
      },
      maxProofsVerified: 2,
    });
  }

  async function createRevealBidProof(
    bidder: PublicKey,
    auctionId: UInt64,
    amount: UInt64,
    salt: Field
  ) {
    // create dummy proof
    return new RevealBidProof({
      proof: dummy,
      publicInput: undefined,
      publicOutput: {
        auctionId,
        amount,
        bidder,
        bidHash: calcBidHash(auctionId, amount, bidder, salt),
      },
      maxProofsVerified: 2,
    });
  }

  async function convertTokenToPrivate(pvtKey: PrivateKey, amount: UInt64) {
    const r = Field.random();
    const publicKey = pvtKey.toPublicKey();
    // TODO remove later when `setSigner` is working
    const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
    inMemorySigner.config.signer = pvtKey;

    // step 1: deposit Tokens and save depositHash
    const depositHashProof = new DepositHashProof({
      proof: dummy,
      publicInput: amount,
      publicOutput: generateDepositHash(amount, r),
      maxProofsVerified: 2,
    });
    let tx = await appChain.transaction(publicKey, () => {
      privateToken.deposit(depositHashProof);
    });
    await tx.sign();
    await tx.send();
    let block = await appChain.produceBlock();
    expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
    const claimNounce =
      0 | Number((await privateTokenQuery.nounces.get(publicKey))?.toBigInt());

    // step 2: call addDeposit to get the private tokens in a `claim`
    const dummyMerkelMap = new MerkleMap(); // TODO remove later when using appChain state
    const dummyWitness = dummyMerkelMap.getWitness(Field(0));
    const [root, key] = dummyWitness.computeRootAndKey(
      generateDepositHash(amount, r)
    );
    const depositProof = new DepositProof({
      proof: dummy,
      publicInput: undefined,
      publicOutput: {
        rootHash: root,
        nullifierHash: Poseidon.hash([r]),
        to: publicKey,
        amount: EncryptedBalance.from(amount, publicKey),
      },
      maxProofsVerified: 2,
    });
    tx = await appChain.transaction(publicKey, () => {
      privateToken.addDeposit(depositProof);
    });
    await tx.sign();
    await tx.send();
    block = await appChain.produceBlock();
    expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
    // step 3: call addClaim to update ledger balance
    tx = await addClaimTxn(pvtKey, claimNounce, claimNounce == 0);
    await tx.sign();
    await tx.send();

    block = await appChain.produceBlock();
    expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
  }

  async function addClaimTxn(
    ownerPrivateKey: PrivateKey,
    claimIndex: number,
    firstClaim = false
  ): Promise<AppChainTransaction> {
    // set signer
    appChain.setSigner(alicePrivateKey);
    // TODO remove later when `setSigner` is working
    const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
    inMemorySigner.config.signer = ownerPrivateKey;

    let currentBalance = (await privateTokenQuery.ledger.get(
      ownerPrivateKey.toPublicKey()
    )) as EncryptedBalance;
    if (currentBalance == undefined) {
      currentBalance = EncryptedBalance.from(
        UInt64.from(0),
        ownerPrivateKey.toPublicKey()
      );
    }

    const claimKey = ClaimKey.from(
      ownerPrivateKey.toPublicKey(),
      UInt64.from(claimIndex)
    );
    const claimBalance = await privateTokenQuery.claims.get(claimKey);
    if (claimBalance === undefined) {
      throw Error("have no claim balance at: " + claimKey.index.toBigInt());
    }

    // create dummy proof
    const resultingBalance = EncryptedBalance.from(
      currentBalance
        .decrypt(ownerPrivateKey)
        .add(claimBalance.decrypt(ownerPrivateKey)),
      ownerPrivateKey.toPublicKey()
    );
    const claimProof = new ClaimProof({
      proof: dummy,
      publicInput: undefined,
      publicOutput: {
        owner: ownerPrivateKey.toPublicKey(),
        currentBalance,
        resultingBalance,
        amount: claimBalance,
      },
      maxProofsVerified: 2,
    });
    // create transaction
    return appChain.transaction(ownerPrivateKey.toPublicKey(), () => {
      if (firstClaim) privateToken.addFirstClaim(claimKey, claimProof);
      else privateToken.addClaim(claimKey, claimProof);
    });
  }
});
