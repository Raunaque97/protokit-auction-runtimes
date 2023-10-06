import { TestingAppChain } from "@proto-kit/sdk";
import { Field, PrivateKey, UInt64 } from "snarkyjs";
import { log } from "@proto-kit/common";
import { PrivateToken } from "./PrivateToken";

log.setLevel("ERROR");

describe("Balances", () => {
  it("should demonstrate how balances work", async () => {
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

    appChain.setSigner(alicePrivateKey);

    const privateToken = appChain.runtime.resolve("PrivateToken");

    // deposit
    let tx = appChain.transaction(alice, () => {});

    // await tx1.sign();
    // await tx1.send();
    // appChain.produceBlock();

    const x = await appChain.query.runtime.PrivateToken.claims.get(
      Field.from(0)
    );

    console.log("x", x);
  });
});
