import { RuntimeModule, runtimeModule, state } from "@proto-kit/module";

import { State } from "@proto-kit/protocol";
import { UInt64 } from "o1js";

@runtimeModule()
export class GlobalCounter extends RuntimeModule<unknown> {
  @state() private counter = State.from<UInt64>(UInt64);

  public incrementBy(amount: UInt64) {
    this.counter.set(this.counter.get().value.add(amount));
  }

  public increment() {
    this.incrementBy(UInt64.one);
  }

  public value() {
    return this.counter.get().value;
  }
}
