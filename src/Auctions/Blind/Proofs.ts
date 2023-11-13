import {
  Experimental,
  Field,
  Poseidon,
  PrivateKey,
  PublicKey,
  Struct,
  UInt64,
} from "o1js";
import { EncryptedBalance } from "../../PrivateToken/Proofs";

export function calcBidHash(
  auctionId: UInt64,
  amount: UInt64,
  bidder: PublicKey,
  salt: Field
): Field {
  return Poseidon.hash([...auctionId.toFields(), ...amount.toFields(), salt]);
}

// currentBalance == resultingBalance + amount
// bidHash = H(auctionId, amount, salt)
export class SealedBidProofOutput extends Struct({
  owner: PublicKey,
  to: PublicKey,
  currentBalance: EncryptedBalance,
  resultingBalance: EncryptedBalance,
  bidHash: Field,
}) {}
export function generateSealedBidProofOutput(
  ownerPrivateKey: PrivateKey,
  currentEncryptedBalance: EncryptedBalance,
  amount: UInt64,
  to: PublicKey,
  auctionId: UInt64,
  salt: Field
): SealedBidProofOutput {
  const currentBal = currentEncryptedBalance.decrypt(ownerPrivateKey);
  currentBal.assertGreaterThanOrEqual(amount, "Not enough Balance");
  const resultingBalance = currentBal.sub(amount);

  const encryptedResultingBalance = EncryptedBalance.from(
    resultingBalance,
    ownerPrivateKey.toPublicKey()
  );

  return new SealedBidProofOutput({
    owner: ownerPrivateKey.toPublicKey(),
    to: to,
    currentBalance: currentEncryptedBalance,
    resultingBalance: encryptedResultingBalance,
    bidHash: calcBidHash(
      auctionId,
      amount,
      ownerPrivateKey.toPublicKey(),
      salt
    ),
  });
}
export const SealedBidProofProgram = Experimental.ZkProgram({
  publicOutput: SealedBidProofOutput,
  methods: {
    generate: {
      privateInputs: [
        PrivateKey,
        EncryptedBalance,
        UInt64,
        PublicKey,
        UInt64,
        Field,
      ],
      method: generateSealedBidProofOutput,
    },
  },
});
export class SealedBidProof extends Experimental.ZkProgram.Proof(
  SealedBidProofProgram
) {}

// bidHash = H(auctionId, amount, salt)
export class RevealBidProofOutput extends Struct({
  auctionId: UInt64,
  amount: UInt64,
  bidder: PublicKey,
  bidHash: Field,
}) {}
export function generateRevealBidProofOutput(
  auctionId: UInt64,
  amount: UInt64,
  bidder: PublicKey,
  salt: Field
): RevealBidProofOutput {
  return new RevealBidProofOutput({
    auctionId,
    amount,
    bidder,
    bidHash: calcBidHash(auctionId, amount, bidder, salt),
  });
}
export const RevealBidProofProgram = Experimental.ZkProgram({
  publicOutput: RevealBidProofOutput,
  methods: {
    generate: {
      privateInputs: [UInt64, UInt64, PublicKey, Field],
      method: generateRevealBidProofOutput,
    },
  },
});
export class RevealBidProof extends Experimental.ZkProgram.Proof(
  RevealBidProofProgram
) {}
