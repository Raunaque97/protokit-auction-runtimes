import {
  Bool,
  Encryption,
  Field,
  Group,
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

  static empty() {
    return new EncryptedBalance({
      publicKey: Group.zero,
      cipherText: [Field(0), Field(0)],
    });
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

//
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
