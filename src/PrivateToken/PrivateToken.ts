import {
  runtimeMethod,
  RuntimeModule,
  runtimeModule,
  state,
} from "@proto-kit/module";
import { assert, State, StateMap } from "@proto-kit/protocol";
import {
  Bool,
  Field,
  Poseidon,
  Provable,
  PublicKey,
  Struct,
  UInt64,
} from "o1js";
import {
  EncryptedBalance,
  MockClaimProof,
  MockDepositProof,
  MockTransferProof,
} from "./Proofs";
import { inject } from "tsyringe";
import { Balances } from "../Balances";

export class ClaimKey extends Struct({
  recipient: PublicKey,
  index: UInt64,
}) {
  public static from(recipient: PublicKey, index: UInt64) {
    return new ClaimKey({ recipient, index });
  }
}

// TODO: replace mockProofs later
@runtimeModule()
export class PrivateToken extends RuntimeModule<unknown> {
  public readonly DEPOSIT_ADDRESS = PublicKey.from({
    // TODO is this good?
    x: Poseidon.hash([Field(42)]),
    isOdd: Bool(false),
  });

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

  @state() public deposits = StateMap.from<UInt64, Field>(UInt64, Field);
  @state() public depositNounce = State.from(UInt64);

  @state() public nullifiers = StateMap.from<Field, Field>(Field, Field);

  public constructor(@inject("Balances") public balance: Balances) {
    super();
    // this.depositNounce.set(Field(0));
  }

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
    // TODO use .delete
    this.claims.set(claimKey, EncryptedBalance.empty());
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
    assert(claimKey.recipient.equals(claimProofOutput.owner), "wrong owner");
    // check stored balance should be undefined.
    assert(
      this.ledger.get(claimProofOutput.owner).isSome.not(),
      "Not first time"
    );
    Provable.log();
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
    // TODO use .delete
    this.claims.set(claimKey, EncryptedBalance.empty());
  }
  /**
   * deposit normal token to get private Token
   * TODO
   */
  @runtimeMethod()
  public deposit(amount: UInt64, depositHash: Field) {
    const nounce = this.depositNounce.get();
    this.deposits.set(nounce.value, depositHash);
    // update depositNounce
    this.depositNounce.set(nounce.value.add(Field(1)));
    // transfer amount to DEPOSIT_ADDRESS
    this.balance.transferFrom(
      this.transaction.sender,
      this.DEPOSIT_ADDRESS,
      amount
    );
  }

  /**
   * converts deposited token to private token
   * TODO
   */
  @runtimeMethod()
  public addDeposit(depositProof: MockDepositProof) {
    depositProof.verify();
    const proofOutput = depositProof.publicOutput;

    // check nullifier does not already exist
    assert(
      this.nullifiers.get(proofOutput.nullifierHash).isSome.not(),
      "Nullifier already used"
    );

    // TODO verifies storage proof
    // proofOutput.path == this.deposits.path
    // proofOutput.rootHash exists in historical hashes

    const to = proofOutput.to;
    const claimKey = ClaimKey.from(to, this.nounces.get(to).value);
    // update nounce
    this.nounces.set(to, this.nounces.get(to).value.add(1));
    // store the claim so it can be claimed later
    this.claims.set(claimKey, proofOutput.amount);
  }
}
