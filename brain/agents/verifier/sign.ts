import { AbiCoder, getBytes, keccak256, verifyMessage, type Wallet } from "ethers";

import { type Bytes32, type Hex, type Verdict } from "../../shared/schemas.js";

const abi = AbiCoder.defaultAbiCoder();

export interface UnsignedVerdict {
  pactId: Bytes32;
  outcome: Verdict["outcome"];
  evidenceHash: Bytes32;
}

export interface SignedVerdict extends Verdict {
  digest: Bytes32;
}

export function verdictDigest(verdict: UnsignedVerdict): Bytes32 {
  return keccak256(
    abi.encode(["bytes32", "uint8", "bytes32"], [verdict.pactId, verdict.outcome, verdict.evidenceHash]),
  ) as Bytes32;
}

export async function signVerdict(input: UnsignedVerdict & { wallet: Wallet }): Promise<SignedVerdict> {
  const digest = verdictDigest(input);
  const verifierSig = (await input.wallet.signMessage(getBytes(digest))) as Hex;

  return {
    pactId: input.pactId,
    outcome: input.outcome,
    evidenceHash: input.evidenceHash,
    verifierSig,
    digest,
  };
}

export function recoverVerdictSigner(verdict: SignedVerdict): Hex {
  return verifyMessage(getBytes(verdict.digest), verdict.verifierSig) as Hex;
}
