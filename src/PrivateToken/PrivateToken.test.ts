import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import { Field, PrivateKey, UInt64, Encryption } from "snarkyjs";
import { log } from "@proto-kit/common";
import { ClaimKey, PrivateToken } from "./PrivateToken";
import {
  EncryptedBalance,
  MockClaimProof,
  MockDepositProof,
  MockTransferProof,
} from "./Proofs";

log.setLevel("ERROR");

describe("Private Token", () => {
  it("should demonstrate how deposit, transfer, claim works", async () => {
    const appChain = TestingAppChain.fromRuntime({
      modules: {
        PrivateToken,
      },
      config: {
        PrivateToken: {},
      },
    });
    await appChain.start();

    const alicePrivateKey = PrivateKey.random();
    const alice = alicePrivateKey.toPublicKey();
    const bobPrivateKey = PrivateKey.random();
    const bob = bobPrivateKey.toPublicKey();

    const privateToken = appChain.runtime.resolve("PrivateToken");
    const queryModule = appChain.query.runtime.PrivateToken;

    // Alice deposits 100
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

    let aliceClaimBalance = (await queryModule.claims.get(
      ClaimKey.from(alice, UInt64.from(0))
    )) as EncryptedBalance;

    expect(
      UInt64.fromFields(
        Encryption.decrypt(aliceClaimBalance, alicePrivateKey)
      ).toBigInt()
    ).toBe(100n);

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

    let aliceBalance = (await queryModule.ledger.get(
      alice
    )) as EncryptedBalance;
    // console.log(
    //   "aliceBalance",
    //   UInt64.fromFields(
    //     Encryption.decrypt(aliceBalance, alicePrivateKey)
    //   ).toBigInt()
    // );
    // console.log(
    //   "aliceBalance",
    //   UInt64.fromFields(
    //     Encryption.decrypt(aliceBalance, alicePrivateKey)
    //   ).toBigInt()
    // );
    expect(
      UInt64.fromFields(
        Encryption.decrypt(aliceBalance, alicePrivateKey)
      ).toBigInt()
    ).toBe(100n);

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

    aliceBalance = (await queryModule.ledger.get(alice)) as EncryptedBalance;
    console.log("aliceBalance", aliceBalance);

    let bobClaimBalance = (await queryModule.claims.get(
      ClaimKey.from(bob, UInt64.from(0))
    )) as EncryptedBalance;
    // console.log(
    //   "bobClaimBalance",
    //   UInt64.fromFields(
    //     Encryption.decrypt(bobClaimBalance, bobPrivateKey)
    //   ).toBigInt()
    // );
    expect(
      UInt64.fromFields(
        Encryption.decrypt(aliceBalance, alicePrivateKey)
      ).toBigInt()
    ).toBe(90n);
    expect(
      UInt64.fromFields(
        Encryption.decrypt(bobClaimBalance, bobPrivateKey)
      ).toBigInt()
    ).toBe(10n);

    // alice deposits and add claim again
    // tx = appChain.transaction(alice, () => {
    //   privateToken.addDeposit(depositProof);
    // });
    // await tx.sign();
    // await tx.send();
    aliceClaimBalance = (await queryModule.claims.get(
      ClaimKey.from(alice, UInt64.from(0))
    )) as EncryptedBalance;
    // console.log(
    //   "aliceClaimBalance",
    //   UInt64.fromFields(
    //     Encryption.decrypt(aliceClaimBalance, alicePrivateKey)
    //   ).toBigInt()
    // );

    tx = appChain.transaction(alice, () => {
      privateToken.addClaim(ClaimKey.from(alice, UInt64.from(0)), claimProof);
    });
    await tx.sign();
    await tx.send();

    await appChain.produceBlock();
  });
});
