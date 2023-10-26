import "reflect-metadata";
import { ModuleQuery, TestingAppChain } from "@proto-kit/sdk";
import { Field, PrivateKey, PublicKey, UInt64 } from "snarkyjs";
import { log } from "@proto-kit/common";
import { ClaimKey, PrivateToken } from "./PrivateToken";
import { PrivateMempool } from "@proto-kit/sequencer";

import {
  EncryptedBalance,
  MockClaimProof,
  MockDepositProof,
  MockTransferProof,
} from "./Proofs";
import { Balances } from "../Balances";

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
  });

  it("should demonstrate how deposit, transfer, claim works", async () => {
    // Alice deposits 100
    // TODO: test deposit()
    appChain.setSigner(alicePrivateKey);
    const depositProof = new MockDepositProof({
      publicOutput: {
        rootHash: Field(0),
        nullifierHash: Field(0),
        to: alice,
        amount: EncryptedBalance.from(UInt64.from(100), alice), // encrypted with 'to' address
      },
    });
    let tx = appChain.transaction(alice, () => {
      privateToken.addDeposit(depositProof);
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    let aliceClaimBalance = (await privateTokenQuery.claims.get(
      ClaimKey.from(alice, UInt64.from(0))
    )) as EncryptedBalance;

    expect(aliceClaimBalance.decrypt(alicePrivateKey).toBigInt()).toBe(100n);

    // alice addClaims
    const claimProof = new MockClaimProof({
      publicOutput: {
        owner: alice,
        currentBalance: EncryptedBalance.from(UInt64.from(0), alice), // this wont matter
        resultingBalance: EncryptedBalance.from(UInt64.from(10), alice), // this wont matter
        amount: depositProof.publicOutput.amount, // need to match
      },
    });
    tx = appChain.transaction(alice, () => {
      privateToken.addFirstClaim(
        ClaimKey.from(alice, UInt64.from(0)),
        claimProof
      );
    });
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
    const transferProof = new MockTransferProof({
      publicOutput: {
        owner: alice,
        to: bob,
        currentBalance: claimProof.publicOutput.amount, // should match
        resultingBalance: EncryptedBalance.from(UInt64.from(90), alice),
        amount: EncryptedBalance.from(UInt64.from(10), bob),
      },
    });
    tx = appChain.transaction(alice, () => {
      privateToken.transfer(transferProof);
    });
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

    // alice deposits and add claim again
    tx = appChain.transaction(alice, () => {
      privateToken.addDeposit(depositProof);
    });
    await tx.sign();
    await tx.send();
    aliceClaimBalance = (await privateTokenQuery.claims.get(
      ClaimKey.from(alice, UInt64.from(0))
    )) as EncryptedBalance;
    // console.log("should be 0: ", aliceClaimBalance.cipherText[0].toBigInt());

    tx = appChain.transaction(alice, () => {
      privateToken.addClaim(ClaimKey.from(alice, UInt64.from(0)), claimProof);
    });
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
  });
});
