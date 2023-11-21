import {
  Bool,
  Encryption,
  Experimental,
  Field,
  Group,
  MerkleMapWitness,
  Poseidon,
  PrivateKey,
  Proof,
  PublicKey,
  Struct,
  UInt64,
} from "o1js";

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
  // TODO remove later
  static empty() {
    return new EncryptedBalance({
      publicKey: Group.zero,
      cipherText: [Field(0), Field(0)],
    });
  }

  public equals(other: EncryptedBalance): Bool {
    return this.publicKey
      .equals(other.publicKey)
      .and(this.cipherText[0].equals(other.cipherText[0]))
      .and(this.cipherText[1].equals(other.cipherText[1]));
  }

  public decrypt(privateKey: PrivateKey): UInt64 {
    const encryptedBalance = {
      publicKey: this.publicKey,
      cipherText: [...this.cipherText],
    }; // this is required to deep-copy
    return UInt64.fromFields(Encryption.decrypt(encryptedBalance, privateKey));
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
export function generateTransferProofOutput(
  ownerPrivateKey: PrivateKey,
  currentEncryptedBalance: EncryptedBalance,
  amount: UInt64,
  to: PublicKey
): TransferProofOutput {
  const currentBal = currentEncryptedBalance.decrypt(ownerPrivateKey);
  currentBal.assertGreaterThanOrEqual(amount, "Not enough Balance");
  const resultingBalance = currentBal.sub(amount);

  const encryptedAmt = EncryptedBalance.from(amount, to);
  const encryptedResultingBalance = EncryptedBalance.from(
    resultingBalance,
    ownerPrivateKey.toPublicKey()
  );

  return new TransferProofOutput({
    owner: ownerPrivateKey.toPublicKey(),
    to: to,
    currentBalance: currentEncryptedBalance,
    resultingBalance: encryptedResultingBalance,
    amount: encryptedAmt,
  });
}
export const transferProofProgram = Experimental.ZkProgram({
  publicOutput: TransferProofOutput,
  methods: {
    generate: {
      privateInputs: [PrivateKey, EncryptedBalance, UInt64, PublicKey],
      method: generateTransferProofOutput,
    },
  },
});
export class TransferProof extends Experimental.ZkProgram.Proof(
  transferProofProgram
) {}

// currentBalance + claimAmount == resultingBalance
export class ClaimProofOutput extends Struct({
  owner: PublicKey,
  currentBalance: EncryptedBalance,
  resultingBalance: EncryptedBalance,
  amount: EncryptedBalance, // encrypted with 'owner' address
}) {}
export function generateClaimProofOutput(
  ownerPrivateKey: PrivateKey,
  currentEncryptedBalance: EncryptedBalance,
  encryptedAmount: EncryptedBalance
): ClaimProofOutput {
  const currentBal = currentEncryptedBalance.decrypt(ownerPrivateKey);
  const amount = encryptedAmount.decrypt(ownerPrivateKey);
  const encryptedResultingBalance = EncryptedBalance.from(
    currentBal.add(amount),
    ownerPrivateKey.toPublicKey()
  );
  return new ClaimProofOutput({
    owner: ownerPrivateKey.toPublicKey(),
    currentBalance: currentEncryptedBalance,
    resultingBalance: encryptedResultingBalance,
    amount: encryptedAmount,
  });
}
export const claimProofProgram = Experimental.ZkProgram({
  publicOutput: ClaimProofOutput,
  methods: {
    generate: {
      privateInputs: [PrivateKey, EncryptedBalance, EncryptedBalance],
      method: generateClaimProofOutput,
    },
  },
});
export class ClaimProof extends Experimental.ZkProgram.Proof(
  claimProofProgram
) {}

/**
 * Proves inclusion of depositHash in deposits
 */
export class DepositProofOutput extends Struct({
  rootHash: Field,
  nullifierHash: Field,
  to: PublicKey,
  amount: EncryptedBalance, // encrypted with 'to' address
}) {}
// depositHash = H(amount, r); nullifier = H(r); r is randomly choosen
export function generateDepositProofOutput(
  to: PublicKey,
  amount: UInt64,
  r: Field,
  merkelWitness: MerkleMapWitness
): DepositProofOutput {
  const depositHash = Poseidon.hash([...amount.toFields(), r]);
  const nullifierHash = Poseidon.hash([r]);
  const [root, key] = merkelWitness.computeRootAndKey(depositHash);
  const encryptedAmount = EncryptedBalance.from(amount, to);
  return new DepositProofOutput({
    rootHash: root,
    nullifierHash: nullifierHash,
    to: to,
    amount: encryptedAmount,
  });
}
export const depositProofProgram = Experimental.ZkProgram({
  publicOutput: DepositProofOutput,
  methods: {
    generate: {
      privateInputs: [PublicKey, UInt64, Field, MerkleMapWitness],
      method: generateDepositProofOutput,
    },
  },
});
export class DepositProof extends Experimental.ZkProgram.Proof(
  depositProofProgram
) {}

/**
 * Proves DepositHash is correctly computed
 */
// depositHash = H(amount, r); r is randomly choosen
export function generateDepositHash(amount: UInt64, r: Field): Field {
  return Poseidon.hash([...amount.toFields(), r]);
}
export const depositHashProgram = Experimental.ZkProgram({
  publicInput: UInt64,
  publicOutput: Field,
  methods: {
    generate: {
      privateInputs: [Field],
      method: generateDepositHash,
    },
  },
});
export class DepositHashProof extends Experimental.ZkProgram.Proof(
  depositHashProgram
) {}

// currentBalance(enc) == resultingBalance(enc) + amount(plain text)
export class WithdrawProofOutput extends Struct({
  owner: PublicKey,
  to: PublicKey,
  currentBalance: EncryptedBalance,
  resultingBalance: EncryptedBalance,
  amount: UInt64,
}) {}
export function generateWithdrawProofOutput(
  ownerPrivateKey: PrivateKey,
  currentEncryptedBalance: EncryptedBalance,
  amount: UInt64,
  to: PublicKey
): WithdrawProofOutput {
  const currentBal = currentEncryptedBalance.decrypt(ownerPrivateKey);
  currentBal.assertGreaterThanOrEqual(amount, "Not enough Balance");
  const resultingBalance = currentBal.sub(amount);

  const encryptedResultingBalance = EncryptedBalance.from(
    resultingBalance,
    ownerPrivateKey.toPublicKey()
  );

  return new WithdrawProofOutput({
    owner: ownerPrivateKey.toPublicKey(),
    to: to,
    currentBalance: currentEncryptedBalance,
    resultingBalance: encryptedResultingBalance,
    amount: amount,
  });
}
export const withdrawProofProgram = Experimental.ZkProgram({
  publicOutput: WithdrawProofOutput,
  methods: {
    generate: {
      privateInputs: [PrivateKey, EncryptedBalance, UInt64, PublicKey],
      method: generateWithdrawProofOutput,
    },
  },
});
export class WithdrawProof extends Experimental.ZkProgram.Proof(
  withdrawProofProgram
) {}
