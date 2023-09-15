import { runtimeMethod, RuntimeModule, state } from "@proto-kit/module";
import { StateMap } from "@proto-kit/protocol";
import assert from "assert";
import { Bool, Field, PublicKey, Struct, UInt32 } from "snarkyjs";

export class NFTKey extends Struct({
  collection: PublicKey,
  id: UInt32,
}) {
  public static from(collection: PublicKey, id: UInt32) {
    return new NFTKey({ collection, id });
  }
}

export class NFTEntity extends Struct({
  owner: PublicKey,
  metadata: Field, // ipfs hash
  locked: Bool,
}) {
  public lock() {
    this.locked = Bool(true);
  }

  public unlock() {
    this.locked = Bool(false);
  }
}

export class NFT extends RuntimeModule<{}> {
  @state() public records = StateMap.from<NFTKey, NFTEntity>(NFTKey, NFTEntity);
  @state() public nonces = StateMap.from<PublicKey, UInt32>(PublicKey, UInt32);

  @runtimeMethod()
  public mint(to: PublicKey, metadata: Field) {
    const minter = this.transaction.sender;
    const minterNonce = this.nonces.get(minter).value;
    const key = NFTKey.from(minter, minterNonce);
    this.records.set(
      key,
      new NFTEntity({ owner: to, metadata, locked: Bool(false) })
    );
    this.nonces.set(minter, minterNonce.add(1));
  }

  @runtimeMethod()
  public transferSigned(to: PublicKey, key: NFTKey) {
    const nft = this.records.get(key).value;
    // check if sender is the current owner
    assert(nft.owner.equals(this.transaction.sender), "Not owner of NFT");
    // check if the NFT is locked
    assert(nft.locked.not(), "NFT is locked and cannot be transferred");
    this.transfer(to, key);
  }

  public transfer(to: PublicKey, key: NFTKey) {
    const nft = this.records.get(key).value;
    // update the owner to the 'to' address
    nft.owner = to;
    this.records.set(key, nft);
  }

  public lock(key: NFTKey) {
    const nft = this.records.get(key).value;
    // lock the nft
    nft.lock();
    this.records.set(key, nft);
  }

  public unlock(key: NFTKey) {
    const nft = this.records.get(key).value;
    // lock the nft
    nft.unlock();
    this.records.set(key, nft);
  }

  public isLocked(key: NFTKey) {
    const nft = this.records.get(key).value;
    assert(nft.locked, "NFT is not locked");
  }
}
