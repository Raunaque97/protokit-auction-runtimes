import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import { Field, PrivateKey, UInt64, Encryption } from "snarkyjs";
import { log } from "@proto-kit/common";
import {
  EncryptedBalance,
  MockDepositProof,
  PrivateToken,
} from "./PrivateToken";

log.setLevel("ERROR");

describe("Private Token", () => {
  it("should demonstrate how deposit, transfer, claim works", async () => {
    const totalSupply = UInt64.from(10_000);

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
      publicOutput: EncryptedBalance.from(UInt64.from(100), alice),
    });
    console.log(
      "correct ",
      depositProof.publicOutput.val.length,
      depositProof.publicOutput.val[0].toBigInt(),
      depositProof.publicOutput.val[1].toBigInt()
    );
    let tx = appChain.transaction(alice, () => {
      privateToken.deposit(depositProof);
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    const aliceBalance = (await queryModule.ledger.get(
      alice
    )) as EncryptedBalance;
    console.log(
      "final ",
      aliceBalance?.val.length,
      aliceBalance?.val[0]?.toBigInt(),
      aliceBalance?.val[1]?.toBigInt()
    );
    expect(
      UInt64.fromFields(
        Encryption.decrypt(
          { publicKey: alice.toGroup(), cipherText: aliceBalance.val },
          alicePrivateKey
        )
      )
    ).toBe(UInt64.from(100));
  });
});
