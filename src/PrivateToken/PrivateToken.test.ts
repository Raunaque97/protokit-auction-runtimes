import "reflect-metadata";
import {
  AppChainTransaction,
  ModuleQuery,
  TestingAppChain,
  InMemorySigner,
} from "@proto-kit/sdk";
import {
  Field,
  MerkleMap,
  MerkleMapWitness,
  Poseidon,
  PrivateKey,
  PublicKey,
  UInt64,
} from "o1js";
import { log } from "@proto-kit/common";
import { ClaimKey, PrivateToken } from "./PrivateToken";

import {
  EncryptedBalance,
  ClaimProof,
  DepositProof,
  TransferProof,
  DepositHashProof,
  generateDepositHash,
} from "./Proofs";
import { Balances } from "../Balances";
import { Pickles } from "o1js/dist/node/snarky";
import { dummyBase64Proof } from "o1js/dist/node/lib/proof_system";

log.setLevel("ERROR");

describe("Private Token", () => {
  let appChain: TestingAppChain<{
    PrivateToken: typeof PrivateToken;
    Balances: typeof Balances;
  }>;
  let alicePrivateKey: PrivateKey;
  let alice: PublicKey;
  let bobPrivateKey: PrivateKey;
  let bob: PublicKey;
  let privateToken: PrivateToken;
  let privateTokenQuery: ModuleQuery<PrivateToken>;
  let balances: Balances;
  let balanceQuery: ModuleQuery<Balances>;

  beforeEach(async () => {
    appChain = TestingAppChain.fromRuntime({
      modules: {
        PrivateToken,
        Balances,
      },
      config: {
        PrivateToken: {},
        Balances: {},
      },
    });
    await appChain.start();

    alicePrivateKey = PrivateKey.random();
    alice = alicePrivateKey.toPublicKey();
    bobPrivateKey = PrivateKey.random();
    bob = bobPrivateKey.toPublicKey();

    privateToken = appChain.runtime.resolve("PrivateToken");
    privateTokenQuery = appChain.query.runtime.PrivateToken;
    balances = appChain.runtime.resolve("Balances");
    balanceQuery = appChain.query.runtime.Balances;

    console.log("Alice: ", alice.toBase58());
    console.log("Bob:   ", bob.toBase58());

    // Alice mints 1000 tokens
    appChain.setSigner(alicePrivateKey);
    const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
    inMemorySigner.config.signer = alicePrivateKey;

    let tx = appChain.transaction(alice, () => {
      balances.setBalance(alice, UInt64.from(1000));
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();
  });

  it("should demonstrate how deposit, transfer, claim works", async () => {
    const r = Field.random(); // only alice knows

    // get alice balance
    console.log(
      "alice bal:",
      (await balanceQuery.balances.get(alice))?.toBigInt()
    );
    appChain.setSigner(alicePrivateKey);
    // alice deposits 100
    const [, dummy] = Pickles.proofOfBase64(await dummyBase64Proof(), 2);
    const depositHashProof = new DepositHashProof({
      proof: dummy,
      publicInput: UInt64.from(100),
      publicOutput: generateDepositHash(UInt64.from(100), r),
      maxProofsVerified: 2,
    });
    let tx = appChain.transaction(alice, () => {
      privateToken.deposit(depositHashProof);
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    // Alice adds deposited amount to encrypted balance
    const dummyMerkelMap = new MerkleMap(); // TODO remove later when using appChain state
    const dummyWitness = dummyMerkelMap.getWitness(Field(0));

    tx = await addDepositTxn(
      alicePrivateKey,
      UInt64.from(100),
      r,
      dummyWitness
    );
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    let aliceClaimBalance = (await privateTokenQuery.claims.get(
      ClaimKey.from(alice, UInt64.from(0))
    )) as EncryptedBalance;
    expect(aliceClaimBalance.decrypt(alicePrivateKey).toBigInt()).toBe(100n);

    // alice addClaims
    tx = await addClaimTxn(alicePrivateKey, 0, true);
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    let aliceBalance = (await privateTokenQuery.ledger.get(
      alice
    )) as EncryptedBalance;
    console.log(
      "aliceBalance",
      aliceBalance.decrypt(alicePrivateKey).toBigInt()
    );
    expect(aliceBalance.decrypt(alicePrivateKey).toBigInt()).toBe(100n);

    // alice sends some to bob
    tx = await transferFromTxn(alicePrivateKey, bob, UInt64.from(10));
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    aliceBalance = (await privateTokenQuery.ledger.get(
      alice
    )) as EncryptedBalance;
    let bobClaimBalance = (await privateTokenQuery.claims.get(
      ClaimKey.from(bob, UInt64.from(0))
    )) as EncryptedBalance;
    console.log(
      "bobClaimBalance",
      bobClaimBalance.decrypt(bobPrivateKey).toBigInt()
    );
    expect(aliceBalance.decrypt(alicePrivateKey).toBigInt()).toBe(90n);
    expect(bobClaimBalance.decrypt(bobPrivateKey).toBigInt()).toBe(10n);

    // alice deposits another 50
    tx = await addDepositTxn(alicePrivateKey, UInt64.from(50), r, dummyWitness);
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();
    // alice add's the claim
    tx = await addClaimTxn(alicePrivateKey, 1, false);
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    aliceBalance = (await privateTokenQuery.ledger.get(
      alice
    )) as EncryptedBalance;
    console.log(
      "aliceBalance",
      aliceBalance.decrypt(alicePrivateKey).toBigInt()
    );
    expect(aliceBalance.decrypt(alicePrivateKey).toBigInt()).toBe(140n);
  });

  // Helpers
  async function transferFromTxn(
    fromPrivateKey: PrivateKey,
    to: PublicKey,
    amount: UInt64
  ): Promise<AppChainTransaction> {
    // set signer
    appChain.setSigner(alicePrivateKey);
    // TODO remove later when `setSigner` is working
    const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
    inMemorySigner.config.signer = fromPrivateKey;

    // get from's balance
    const currentBalance = (await privateTokenQuery.ledger.get(
      fromPrivateKey.toPublicKey()
    )) as EncryptedBalance;
    if (currentBalance == undefined) {
      throw Error("have no balance");
    }
    // create dummy proof
    const [, dummy] = Pickles.proofOfBase64(await dummyBase64Proof(), 2);
    const decryptedBalance = currentBalance.decrypt(fromPrivateKey);
    const resultingBalance = EncryptedBalance.from(
      decryptedBalance.sub(amount),
      fromPrivateKey.toPublicKey()
    );
    const transferProof = new TransferProof({
      proof: dummy,
      publicInput: undefined,
      publicOutput: {
        owner: fromPrivateKey.toPublicKey(),
        to,
        currentBalance,
        resultingBalance,
        amount: EncryptedBalance.from(amount, to),
      },
      maxProofsVerified: 2,
    });
    // create transaction
    return appChain.transaction(fromPrivateKey.toPublicKey(), () => {
      privateToken.transfer(transferProof);
    });
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
    const claimBalance = (await privateTokenQuery.claims.get(
      claimKey
    )) as EncryptedBalance;

    // create dummy proof
    const [, dummy] = Pickles.proofOfBase64(await dummyBase64Proof(), 2);
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

  async function addDepositTxn(
    ownerPrivateKey: PrivateKey,
    amount: UInt64,
    r: Field,
    merkelWitness: MerkleMapWitness
  ): Promise<AppChainTransaction> {
    // set signer
    appChain.setSigner(alicePrivateKey);
    // TODO remove later when `setSigner` is working
    const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
    inMemorySigner.config.signer = ownerPrivateKey;

    const depositHash = Poseidon.hash([...amount.toFields(), r]);
    const nullifierHash = Poseidon.hash([r]);
    const [root, key] = merkelWitness.computeRootAndKey(depositHash);

    // create dummy proof
    const [, dummy] = Pickles.proofOfBase64(await dummyBase64Proof(), 2);
    const depositProof = new DepositProof({
      proof: dummy,
      publicInput: undefined,
      publicOutput: {
        rootHash: root,
        nullifierHash: nullifierHash,
        to: ownerPrivateKey.toPublicKey(),
        amount: EncryptedBalance.from(amount, ownerPrivateKey.toPublicKey()),
      },
      maxProofsVerified: 2,
    });
    // create transaction
    return appChain.transaction(ownerPrivateKey.toPublicKey(), () => {
      privateToken.addDeposit(depositProof);
    });
  }
});
