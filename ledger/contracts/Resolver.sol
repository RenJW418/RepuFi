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
    uint256 public reviewThreshold = 2;

    struct Review {
        bool open;
        PactMarket.Outcome oracleOutcome;
        PactMarket.Outcome agentOutcome;
        bytes32 evidenceHash;
        uint256 keptVotes;
        uint256 breachedVotes;
    }

    mapping(bytes32 => Review) public reviews;
    mapping(bytes32 => mapping(address => bool)) public hasReviewVoted;
    mapping(bytes32 => mapping(address => bool)) public relatedPartyOf;

    event VerifierSet(address indexed verifier, bool allowed);
    event AdapterSet(uint8 indexed predType, address indexed adapter);
    event ReviewThresholdSet(uint256 threshold);
    event RelatedPartySet(bytes32 indexed id, address indexed account, bool related);
    event VerdictSubmitted(bytes32 indexed id, PactMarket.Outcome outcome, bytes32 evidenceHash, address verifier);
    event SelfResolved(bytes32 indexed id, uint8 predType, PactMarket.Outcome outcome, bytes32 evidenceHash);
    event ReviewOpened(
        bytes32 indexed id,
        PactMarket.Outcome oracleOutcome,
        PactMarket.Outcome agentOutcome,
        bytes32 evidenceHash
    );
    event ReviewVoteCast(
        bytes32 indexed id,
        address indexed voter,
        PactMarket.Outcome outcome,
        uint256 breachedVotes,
        uint256 keptVotes
    );
    event ReviewFinalized(bytes32 indexed id, PactMarket.Outcome outcome, bytes32 evidenceHash);

    error UnauthorizedVerifier();
    error InvalidAdapter();
    error PredicateMismatch();
    error NotResolvable();
    error InvalidOutcome();
    error TooEarlyToBreach();
    error InvalidReviewThreshold();
    error OracleAgentAgree();
    error ReviewAlreadyOpen();
    error ReviewNotOpen();
    error ConflictedVoter();
    error AlreadyVoted();

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

    function setReviewThreshold(uint256 threshold) external onlyOwner {
        if (threshold == 0) revert InvalidReviewThreshold();
        reviewThreshold = threshold;
        emit ReviewThresholdSet(threshold);
    }

    function setRelatedParty(bytes32 id, address account, bool related) external onlyOwner {
        relatedPartyOf[id][account] = related;
        emit RelatedPartySet(id, account, related);
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

    function submitDisputedVerdict(
        bytes32 id,
        PactMarket.Outcome oracleOutcome,
        PactMarket.Outcome agentOutcome,
        bytes32 evidenceHash,
        bytes calldata sig
    ) external {
        if (oracleOutcome != PactMarket.Outcome.Kept && oracleOutcome != PactMarket.Outcome.Breached) {
            revert InvalidOutcome();
        }
        if (agentOutcome != PactMarket.Outcome.Kept && agentOutcome != PactMarket.Outcome.Breached) {
            revert InvalidOutcome();
        }
        if (oracleOutcome == agentOutcome) revert OracleAgentAgree();
        if (reviews[id].open) revert ReviewAlreadyOpen();

        address verifier = recoverVerifier(id, oracleOutcome, evidenceHash, sig);
        if (!isVerifier[verifier]) revert UnauthorizedVerifier();

        reviews[id] = Review({
            open: true,
            oracleOutcome: oracleOutcome,
            agentOutcome: agentOutcome,
            evidenceHash: evidenceHash,
            keptVotes: 0,
            breachedVotes: 0
        });
        emit ReviewOpened(id, oracleOutcome, agentOutcome, evidenceHash);
    }

    function voteReview(bytes32 id, PactMarket.Outcome outcome) external {
        if (outcome != PactMarket.Outcome.Kept && outcome != PactMarket.Outcome.Breached) revert InvalidOutcome();
        Review storage review = reviews[id];
        if (!review.open) revert ReviewNotOpen();
        if (hasReviewVoted[id][msg.sender]) revert AlreadyVoted();
        if (_isConflicted(id, msg.sender)) revert ConflictedVoter();

        hasReviewVoted[id][msg.sender] = true;
        if (outcome == PactMarket.Outcome.Kept) {
            review.keptVotes += 1;
        } else {
            review.breachedVotes += 1;
        }

        emit ReviewVoteCast(id, msg.sender, outcome, review.breachedVotes, review.keptVotes);

        if (review.keptVotes >= reviewThreshold || review.breachedVotes >= reviewThreshold) {
            PactMarket.Outcome finalOutcome =
                review.keptVotes >= reviewThreshold ? PactMarket.Outcome.Kept : PactMarket.Outcome.Breached;
            bytes32 evidenceHash = review.evidenceHash;
            review.open = false;
            market.resolve(id, finalOutcome, evidenceHash);
            emit ReviewFinalized(id, finalOutcome, evidenceHash);
        }
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

    function _isConflicted(bytes32 id, address account) internal view returns (bool) {
        PactMarket.Pact memory pact = market.getPact(id);
        return account == pact.subject || relatedPartyOf[id][account]
            || market.stakeOf(id, PactMarket.Side.Commit, account) > 0
            || market.stakeOf(id, PactMarket.Side.Skeptic, account) > 0;
    }
}
