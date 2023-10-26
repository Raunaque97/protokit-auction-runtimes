import {
  RuntimeModule,
  runtimeModule,
  state,
  runtimeMethod,
} from "@proto-kit/module";

import { State, StateMap, assert } from "@proto-kit/protocol";
import { PublicKey, UInt64 } from "o1js";

@runtimeModule()
export class Balances extends RuntimeModule<unknown> {
  @state() public balances!: StateMap<PublicKey, UInt64>;
  @state() public circulatingSupply = State.from<UInt64>(UInt64);

  public constructor() {
    super();
    this.balances = StateMap.from<PublicKey, UInt64>(PublicKey, UInt64);
  }

  @runtimeMethod()
  public setBalance(address: PublicKey, amount: UInt64) {
    const circulatingSupply = this.circulatingSupply.get();
    this.circulatingSupply.set(circulatingSupply.value.add(amount));

    const currentBalance = this.balances.get(address);
    const newBalance = currentBalance.value.add(amount);

    this.balances.set(address, newBalance);
  }

  @runtimeMethod()
  public transfer(to: PublicKey, amount: UInt64) {
    this.transferFrom(this.transaction.sender, to, amount);
  }

  public transferFrom(from: PublicKey, to: PublicKey, amount: UInt64) {
    const fromBalance = this.balances.get(from);
    assert(fromBalance.value.greaterThanOrEqual(amount), "not enough balance");
    const toBalance = this.balances.get(to);
    this.balances.set(from, fromBalance.value.sub(amount));
    this.balances.set(to, toBalance.value.add(amount));
  }
}
