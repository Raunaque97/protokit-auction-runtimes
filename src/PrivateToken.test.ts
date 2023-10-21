import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import { Field, PrivateKey, UInt64, Encryption } from "snarkyjs";
import { log } from "@proto-kit/common";
import {
  ClaimKey,
  EncryptedBalance,
  MockDepositProof,
  PrivateToken,
} from "./PrivateToken";

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

    const aliceBalance = (await queryModule.claims.get(
      ClaimKey.from(alice, UInt64.from(0))
    )) as EncryptedBalance;

    expect(
      UInt64.fromFields(
        Encryption.decrypt(aliceBalance, alicePrivateKey)
      ).toBigInt()
    ).toBe(100n);
  });
});
