// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PactMarket} from "./PactMarket.sol";
import {IPredicateAdapter} from "./interfaces/IPredicateAdapter.sol";

contract Resolver is Ownable {
    using ECDSA for bytes32;

    PactMarket public immutable market;

    mapping(address => bool) public isVerifier;
    mapping(uint8 => address) public adapterOf;

    event VerifierSet(address indexed verifier, bool allowed);
    event AdapterSet(uint8 indexed predType, address indexed adapter);
    event VerdictSubmitted(bytes32 indexed id, PactMarket.Outcome outcome, bytes32 evidenceHash, address verifier);
    event SelfResolved(bytes32 indexed id, uint8 predType, PactMarket.Outcome outcome, bytes32 evidenceHash);

    error UnauthorizedVerifier();
    error InvalidAdapter();
    error PredicateMismatch();
    error NotResolvable();
    error InvalidOutcome();
    error TooEarlyToBreach();

    constructor(address initialOwner, address market_) Ownable(initialOwner) {
        market = PactMarket(market_);
    }

    function setVerifier(address verifier, bool allowed) external onlyOwner {
        isVerifier[verifier] = allowed;
        emit VerifierSet(verifier, allowed);
    }

    function setAdapter(uint8 predType, address adapter) external onlyOwner {
        adapterOf[predType] = adapter;
        emit AdapterSet(predType, adapter);
    }

    function verdictDigest(bytes32 id, PactMarket.Outcome outcome, bytes32 evidenceHash) public pure returns (bytes32) {
        return keccak256(abi.encode(id, uint8(outcome), evidenceHash));
    }

    function recoverVerifier(
        bytes32 id,
        PactMarket.Outcome outcome,
        bytes32 evidenceHash,
        bytes calldata sig
    ) public pure returns (address) {
        bytes32 digest = verdictDigest(id, outcome, evidenceHash);
        return MessageHashUtils.toEthSignedMessageHash(digest).recover(sig);
    }

    function submitVerdict(
        bytes32 id,
        PactMarket.Outcome outcome,
        bytes32 evidenceHash,
        bytes calldata sig
    ) external {
        if (outcome != PactMarket.Outcome.Kept && outcome != PactMarket.Outcome.Breached) revert InvalidOutcome();
        address verifier = recoverVerifier(id, outcome, evidenceHash, sig);
        if (!isVerifier[verifier]) revert UnauthorizedVerifier();

        market.resolve(id, outcome, evidenceHash);
        emit VerdictSubmitted(id, outcome, evidenceHash, verifier);
    }

    function selfResolve(bytes32 id, uint8 predType, bytes calldata paramsBlob) external {
        address adapter = adapterOf[predType];
        if (adapter == address(0)) revert InvalidAdapter();

        PactMarket.Pact memory pact = market.getPact(id);
        if (pact.predType != predType || market.hashPredicate(predType, paramsBlob) != pact.predicateHash) {
            revert PredicateMismatch();
        }

        (bool ready, IPredicateAdapter.Outcome adapterOutcome, bytes32 evidenceHash) =
            IPredicateAdapter(adapter).check(paramsBlob);
        if (!ready) revert NotResolvable();
        if (adapterOutcome != IPredicateAdapter.Outcome.Kept && adapterOutcome != IPredicateAdapter.Outcome.Breached) {
            revert InvalidOutcome();
        }
        if (adapterOutcome == IPredicateAdapter.Outcome.Breached && block.timestamp < pact.deadline) {
            revert TooEarlyToBreach();
        }

        PactMarket.Outcome outcome =
            adapterOutcome == IPredicateAdapter.Outcome.Kept ? PactMarket.Outcome.Kept : PactMarket.Outcome.Breached;

        market.resolve(id, outcome, evidenceHash);
        emit SelfResolved(id, predType, outcome, evidenceHash);
    }
}
