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
  Group,
  Poseidon,
  Proof,
  PublicKey,
  Struct,
  UInt64,
} from "snarkyjs";

// publicKey acts like salt,
// `Encryption.encrypt(..)` randomly generates the publicKey & is required during decryption
export class EncryptedBalance extends Struct({
  publicKey: Group,
  cipherText: [Field, Field],
}) {
  public static from(amount: UInt64, publicKey: PublicKey) {
    return new EncryptedBalance(
      Encryption.encrypt(amount.toFields(), publicKey)
    );
  }

  public equals(other: EncryptedBalance): Bool {
    return this.publicKey
      .equals(other.publicKey)
      .and(this.cipherText[0].equals(other.cipherText[0]))
      .and(this.cipherText[1].equals(other.cipherText[1]));
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
export class DepositProofOutput extends Struct({
  rootHash: Field,
  nullifierHash: Field,
  to: PublicKey,
  amount: EncryptedBalance, // encrypted with 'to' address
}) {}
export class DepositProof extends Proof<unknown, EncryptedBalance> {}
export class MockDepositProof extends Struct({
  publicOutput: DepositProofOutput,
}) {
  public verify() {}
  public verifyIf(condition: Bool) {}
}

// TODO: replace mockProofs later
@runtimeModule()
export class PrivateToken extends RuntimeModule<unknown> {
  @state() public ledger = StateMap.from<PublicKey, EncryptedBalance>(
    PublicKey,
    EncryptedBalance
  );
  // unspent claims, like unspent outputs?
  @state() public claims = StateMap.from<ClaimKey, EncryptedBalance>(
    ClaimKey,
    EncryptedBalance
  );
  // a counter per user for each new claim
  @state() public nounces = StateMap.from<PublicKey, UInt64>(PublicKey, UInt64);

  @runtimeMethod()
  public transfer(transferProof: MockTransferProof) {
    const transferProofOutput = transferProof.publicOutput;
    transferProof.verify();
    /**
     * Check that the transferProof's innitial balance matches
     * with the known/stored balance on chain.
     */
    const currentBalance = this.ledger.get(transferProofOutput.owner).value;
    assert(
      transferProofOutput.currentBalance.equals(currentBalance),
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
  public addClaim(claimKey: ClaimKey, claimProof: MockClaimProof) {
    claimProof.verify();
    const claimProofOutput = claimProof.publicOutput;
    // claimProof shows they can decrypt the claim
    assert(claimKey.recipient.equals(claimProofOutput.owner)); // only intended receipent can add

    /**
     * Check that the claimProof's innitial balance matches
     * with the known/stored balance on chain.
     */
    const currentBalance = this.ledger.get(claimProofOutput.owner).value;
    assert(
      claimProofOutput.currentBalance.equals(currentBalance),
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
      claim.equals(claimProofOutput.amount),
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
  public addFirstClaim(claimKey: ClaimKey, claimProof: MockClaimProof) {
    claimProof.verify();
    const claimProofOutput = claimProof.publicOutput;
    // only intended receipent can add
    assert(claimKey.recipient.equals(claimProofOutput.owner));
    // check stored balance should be undefined.
    assert(
      this.ledger.get(claimProofOutput.owner).isSome.not(),
      "Not first time"
    );
    /**
     * Update the encrypted balance in the ledger directly
     * with claim amount as account starts with Zero
     */
    this.ledger.set(claimProofOutput.owner, claimProofOutput.amount);
    /**
     * the Claim spend should have the same balance as in the claimProof
     */
    const claim = this.claims.get(claimKey).value;
    assert(
      claim.equals(claimProofOutput.amount),
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
  public addDeposit(depositProof: MockDepositProof) {
    // console.log(
    //   "deposit ",
    //   depositProof.publicOutput.val.length,
    //   depositProof.publicOutput.val[0]?.toBigInt(),
    //   depositProof.publicOutput.val[1]?.toBigInt()
    // );
    const proofOutput = depositProof.publicOutput;
    depositProof.verify();
    const to = proofOutput.to;
    const claimKey = ClaimKey.from(to, this.nounces.get(to).value);
    // update nounce
    this.nounces.set(to, this.nounces.get(to).value.add(1));
    // store the claim so it can be claimed later
    this.claims.set(claimKey, proofOutput.amount);
  }
}
