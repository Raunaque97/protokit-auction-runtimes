import {
  runtimeMethod,
  RuntimeModule,
  runtimeModule,
  state,
} from "@proto-kit/module";
import { assert, StateMap } from "@proto-kit/protocol";
import {
  Bool,
  Encryption,
  Field,
  Poseidon,
  Proof,
  PublicKey,
  Struct,
  UInt64,
} from "snarkyjs";

// encrypted (Field[]) + hashed into a single Field
export class EncryptedBalance extends Struct({
  val: [Field], // TODO array size 2
}) {
  public static from(amount: UInt64, publicKey: PublicKey) {
    return new EncryptedBalance({
      val: Encryption.encrypt(amount.toFields(), publicKey).cipherText,
    });
  }
}

export class ClaimKey extends Struct({
  recipient: PublicKey,
  index: UInt64,
}) {
  public static from(recipient: PublicKey, index: UInt64) {
    return new ClaimKey({ recipient, index });
  }
}

// currentBalance == resultingBalance + amount
export class TransferProofOutput extends Struct({
  owner: PublicKey,
  to: PublicKey,
  currentBalance: EncryptedBalance,
  resultingBalance: EncryptedBalance,
  amount: EncryptedBalance, // encrypted with 'to' address
}) {}
export class TransferProof extends Proof<unknown, TransferProofOutput> {}
export class MockTransferProof extends Struct({
  publicOutput: TransferProofOutput,
}) {
  public verify() {}
  public verifyIf(condition: Bool) {}
}

// currentBalance + amount == resultingBalance
export class ClaimProofOutput extends Struct({
  owner: PublicKey,
  currentBalance: EncryptedBalance,
  resultingBalance: EncryptedBalance,
  amount: EncryptedBalance, // encrypted with 'owner' address
}) {}
export class ClaimProof extends Proof<unknown, ClaimProofOutput> {}
export class MockClaimProof extends Struct({
  publicOutput: ClaimProofOutput,
}) {
  public verify() {}
  public verifyIf(condition: Bool) {}
}

export class DepositProof extends Proof<unknown, EncryptedBalance> {}
export class MockDepositProof extends Struct({
  publicOutput: EncryptedBalance,
}) {
  public verify() {}
  public verifyIf(condition: Bool) {}
}

@runtimeModule()
export class PrivateToken extends RuntimeModule<unknown> {
  // ledger of latest known publicKey - balances
  @state() public ledger = StateMap.from(PublicKey, EncryptedBalance);

  // unspent claims, like unspent outputs?
  @state() public claims = StateMap.from(ClaimKey, EncryptedBalance);

  // nounce counter per user.
  @state() public nounces = StateMap.from<PublicKey, UInt64>(PublicKey, UInt64);

  @runtimeMethod()
  public transfer(transferProof: TransferProof | MockTransferProof) {
    const transferProofOutput = transferProof.publicOutput;
    transferProof.verify();
    /**
     * Check that the user transfering knows their own balance
     * by being able to decrypt the publicly known/stored balance
     */
    const currentBalance = this.ledger.get(transferProofOutput.owner);
    assert(
      transferProofOutput.currentBalance.val[0].equals(
        currentBalance.value.val[0]
      ),
      "Proven encrypted balance does not match current known encrypted balance"
    );
    assert(
      transferProofOutput.currentBalance.val[0].equals(
        currentBalance.value.val[1]
      ),
      "Proven encrypted balance does not match current known encrypted balance"
    );

    /**
     * Update the encrypted balance stored in the ledger using
     * the calculated values from the proof
     */
    this.ledger.set(
      transferProofOutput.owner,
      transferProofOutput.resultingBalance
    );
    /**
     * At this point we have authorized the sender knows their balance,
     * and also that it is sufficient to make this transfer.
     *
     * We can create a claim that will increase the recipient's balance
     * when eventually claimed
     */
    const to = transferProofOutput.to;
    const claimKey = ClaimKey.from(to, this.nounces.get(to).value);
    // update nounce
    this.nounces.set(to, this.nounces.get(to).value.add(1));
    // store the claim so it can be claimed later
    this.claims.set(claimKey, transferProofOutput.amount);
  }

  @runtimeMethod()
  public addClaim(claimKey: ClaimKey, claimProof: ClaimProof | MockClaimProof) {
    claimProof.verify();
    const claimProofOutput = claimProof.publicOutput;
    //
    assert(claimKey.recipient.equals(claimProofOutput.owner)); // is this needed? a claimProof shows they can decrypt it

    const currentBalance = this.ledger.get(claimProofOutput.owner).value;
    assert(
      claimProofOutput.currentBalance.val[0].equals(currentBalance.val[0]),
      "Proven encrypted balance does not match current known encrypted balance"
    );
    assert(
      claimProofOutput.currentBalance.val[0].equals(currentBalance.val[1]),
      "Proven encrypted balance does not match current known encrypted balance"
    );
    /**
     * Update the encrypted balance stored in the ledger using
     * the calculated values from the proof
     */
    this.ledger.set(claimProofOutput.owner, claimProofOutput.resultingBalance);

    /**
     * the Claim spend should have the same balance as in the claimProof
     */
    const claim = this.claims.get(claimKey).value;
    assert(
      claim.val[0].equals(claimProofOutput.amount.val[0]),
      "claim amount does not match claimProof amount"
    );
    assert(
      claim.val[0].equals(claimProofOutput.amount.val[1]),
      "claim amount does not match claimProof amount"
    );
    // update the claim to prevent double spent
    this.claims.set(
      claimKey,
      EncryptedBalance.from(UInt64.zero, PublicKey.empty())
    );
  }

  /**
   * When your current balance is 0
   * @param claimKey
   * @param claimProof
   */
  @runtimeMethod()
  public addFirstClaim(
    claimKey: ClaimKey,
    claimProof: ClaimProof | MockClaimProof
  ) {
    claimProof.verify();
    const claimProofOutput = claimProof.publicOutput;
    // is this needed? a claimProof shows they can decrypt it
    assert(claimKey.recipient.equals(claimProofOutput.owner));

    // TODO: check stored balance should be undefined.

    /**
     * account should start with zero balance
     */
    const zeroBalance = EncryptedBalance.from(
      UInt64.zero,
      claimProofOutput.owner
    );
    assert(claimProofOutput.currentBalance.val[0].equals(zeroBalance.val[0]));
    assert(claimProofOutput.currentBalance.val[1].equals(zeroBalance.val[1]));

    /**
     * Update the encrypted balance stored in the ledger using
     * the calculated values from the proof
     */
    this.ledger.set(claimProofOutput.owner, claimProofOutput.resultingBalance);

    /**
     * the Claim spend should have the same balance as in the claimProof
     */
    const claim = this.claims.get(claimKey).value;
    assert(
      claim.val[0].equals(claimProofOutput.amount.val[0]),
      "claim amount does not match claimProof amount"
    );
    assert(
      claim.val[0].equals(claimProofOutput.amount.val[1]),
      "claim amount does not match claimProof amount"
    );
    // update the claim to prevent double spent
    this.claims.set(
      claimKey,
      EncryptedBalance.from(UInt64.zero, PublicKey.empty())
    );
  }

  /**
   * deposit normal token to get private Token
   * TODO
   */
  @runtimeMethod()
  public deposit(depositProof: DepositProof | MockDepositProof) {
    depositProof.verify();
    // TODO
    this.ledger.set(this.transaction.sender, depositProof.publicOutput);
  }
}
