// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICredibility} from "./interfaces/ICredibility.sol";

contract PactMarket is Ownable, ReentrancyGuard {
    enum Side {
        Commit,
        Skeptic
    }

    enum Outcome {
        Pending,
        Kept,
        Breached
    }

    struct Pact {
        address subject;
        bytes32 predicateHash;
        uint8 predType;
        uint64 deadline;
        uint256 bond;
        uint256 commitPool;
        uint256 skepticPool;
        uint256 rewardPool;
        uint256 insurancePool;
        uint256 communityPool;
        uint64 closeProbBps;
        bool closeSnapshotted;
        Outcome outcome;
        bool settled;
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant KEPT_WINNER_REWARD_BPS = 8_000;
    uint256 public constant BREACHED_COMMIT_TO_WINNERS_BPS = 7_000;
    uint256 public constant BREACHED_BOND_TO_WINNERS_BPS = 4_000;
    uint256 public constant BREACHED_BOND_TO_COMMUNITY_BPS = 5_000;

    ICredibility public credibility;
    address public resolver;
    address public insuranceTreasury;
    address public communityTreasury;

    mapping(bytes32 => Pact) public pacts;
    mapping(address => uint256) public nonceOf;
    mapping(bytes32 => mapping(Side => mapping(address => uint256))) public stakeOf;
    mapping(bytes32 => mapping(address => bool)) public claimed;
    mapping(bytes32 => uint256) public claimedWinStake;
    mapping(bytes32 => uint256) public rewardPaid;

    event ResolverSet(address indexed resolver);
    event CredibilitySet(address indexed credibility);
    event TreasuriesSet(address indexed insuranceTreasury, address indexed communityTreasury);
    event PactCreated(
        bytes32 indexed id,
        address indexed subject,
        bytes32 indexed predicateHash,
        uint8 predType,
        uint64 deadline,
        uint256 bond,
        bytes paramsBlob
    );
    event PositionTaken(bytes32 indexed id, Side indexed side, address indexed account, uint256 amount, uint256 breachProbBps);
    event CloseSnapshotted(bytes32 indexed id, uint64 closeProbBps);
    event Settled(bytes32 indexed id, Outcome outcome, bytes32 evidenceHash, uint64 closeProbBps);
    event RewardBuckets(bytes32 indexed id, uint256 winnerRewardPool, uint256 insurancePool, uint256 communityPool);
    event Claimed(bytes32 indexed id, address indexed account, Side side, uint256 payout);
    event TreasuryPaid(bytes32 indexed id, address indexed treasury, uint256 amount, string bucket);

    error InvalidDeadline();
    error EmptyBond();
    error EmptyStake();
    error PactExists();
    error PactMissing();
    error Closed();
    error Early();
    error AlreadySettled();
    error NotResolver();
    error NotSettled();
    error NothingToClaim();
    error TransferFailed();
    error InvalidOutcome();
    error InvalidTreasury();

    constructor(address initialOwner, address credibility_) Ownable(initialOwner) {
        credibility = ICredibility(credibility_);
        insuranceTreasury = initialOwner;
        communityTreasury = initialOwner;
        emit CredibilitySet(credibility_);
        emit TreasuriesSet(initialOwner, initialOwner);
    }

    modifier onlyExisting(bytes32 id) {
        if (pacts[id].subject == address(0)) revert PactMissing();
        _;
    }

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    function setResolver(address newResolver) external onlyOwner {
        resolver = newResolver;
        emit ResolverSet(newResolver);
    }

    function setCredibility(address newCredibility) external onlyOwner {
        credibility = ICredibility(newCredibility);
        emit CredibilitySet(newCredibility);
    }

    function setTreasuries(address newInsuranceTreasury, address newCommunityTreasury) external onlyOwner {
        if (newInsuranceTreasury == address(0) || newCommunityTreasury == address(0)) revert InvalidTreasury();
        insuranceTreasury = newInsuranceTreasury;
        communityTreasury = newCommunityTreasury;
        emit TreasuriesSet(newInsuranceTreasury, newCommunityTreasury);
    }

    function hashPredicate(uint8 predType, bytes calldata paramsBlob) public pure returns (bytes32) {
        return keccak256(abi.encode(predType, paramsBlob));
    }

    function previewPactId(address subject, bytes32 predicateHash, uint64 deadline, uint256 nonce) public pure returns (bytes32) {
        return keccak256(abi.encode(subject, predicateHash, deadline, nonce));
    }

    function createPact(uint8 predType, bytes calldata paramsBlob, uint64 deadline) external payable returns (bytes32 id) {
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (msg.value == 0) revert EmptyBond();

        bytes32 predicateHash = hashPredicate(predType, paramsBlob);
        uint256 nonce = nonceOf[msg.sender]++;
        id = previewPactId(msg.sender, predicateHash, deadline, nonce);
        if (pacts[id].subject != address(0)) revert PactExists();

        pacts[id] = Pact({
            subject: msg.sender,
            predicateHash: predicateHash,
            predType: predType,
            deadline: deadline,
            bond: msg.value,
            commitPool: 0,
            skepticPool: 0,
            rewardPool: 0,
            insurancePool: 0,
            communityPool: 0,
            closeProbBps: 0,
            closeSnapshotted: false,
            outcome: Outcome.Pending,
            settled: false
        });

        emit PactCreated(id, msg.sender, predicateHash, predType, deadline, msg.value, paramsBlob);
    }

    function getPact(bytes32 id) external view returns (Pact memory) {
        return pacts[id];
    }

    function takePosition(bytes32 id, Side side) external payable onlyExisting(id) {
        Pact storage pact = pacts[id];
        if (pact.outcome != Outcome.Pending || block.timestamp >= pact.deadline) revert Closed();
        if (msg.value == 0) revert EmptyStake();

        if (side == Side.Commit) {
            pact.commitPool += msg.value;
        } else {
            pact.skepticPool += msg.value;
        }

        stakeOf[id][side][msg.sender] += msg.value;
        emit PositionTaken(id, side, msg.sender, msg.value, impliedBreachProb(id));
    }

    function impliedBreachProb(bytes32 id) public view onlyExisting(id) returns (uint256 bps) {
        Pact storage pact = pacts[id];
        uint256 total = pact.commitPool + pact.skepticPool;
        return total == 0 ? 5_000 : (pact.skepticPool * BPS) / total;
    }

    function snapshotClose(bytes32 id) public onlyExisting(id) {
        Pact storage pact = pacts[id];
        if (block.timestamp < pact.deadline) revert Early();
        if (pact.settled) revert AlreadySettled();
        if (!pact.closeSnapshotted) {
            pact.closeProbBps = uint64(impliedBreachProb(id));
            pact.closeSnapshotted = true;
            emit CloseSnapshotted(id, pact.closeProbBps);
        }
    }

    function resolve(bytes32 id, Outcome outcome, bytes32 evidenceHash) external onlyResolver onlyExisting(id) {
        _resolve(id, outcome, evidenceHash);
    }

    function _resolve(bytes32 id, Outcome outcome, bytes32 evidenceHash) internal {
        Pact storage pact = pacts[id];
        if (pact.settled) revert AlreadySettled();
        if (outcome != Outcome.Kept && outcome != Outcome.Breached) revert InvalidOutcome();

        if (!pact.closeSnapshotted) {
            pact.closeProbBps = uint64(impliedBreachProb(id));
            pact.closeSnapshotted = true;
            emit CloseSnapshotted(id, pact.closeProbBps);
        }

        pact.outcome = outcome;
        pact.settled = true;
        uint256 subjectBond = pact.bond;
        if (outcome == Outcome.Kept) {
            _settleKept(id, pact);
        } else {
            _settleBreached(id, pact);
        }

        credibility.onSettle(
            pact.subject,
            outcome == Outcome.Kept ? ICredibility.Outcome.Kept : ICredibility.Outcome.Breached,
            subjectBond,
            pact.closeProbBps
        );

        emit Settled(id, outcome, evidenceHash, pact.closeProbBps);
        emit RewardBuckets(id, pact.rewardPool, pact.insurancePool, pact.communityPool);
    }

    function _settleKept(bytes32 id, Pact storage pact) internal {
        uint256 subjectBond = pact.bond;
        pact.rewardPool = (pact.skepticPool * KEPT_WINNER_REWARD_BPS) / BPS;
        pact.insurancePool = pact.skepticPool - pact.rewardPool;
        pact.bond = 0;

        (bool ok,) = pact.subject.call{value: subjectBond}("");
        if (!ok) revert TransferFailed();
        _payTreasury(id, insuranceTreasury, pact.insurancePool, "insurance");
    }

    function _settleBreached(bytes32 id, Pact storage pact) internal {
        uint256 subjectBond = pact.bond;
        uint256 commitWinnerReward = (pact.commitPool * BREACHED_COMMIT_TO_WINNERS_BPS) / BPS;
        uint256 bondWinnerReward = (subjectBond * BREACHED_BOND_TO_WINNERS_BPS) / BPS;
        pact.rewardPool = commitWinnerReward + bondWinnerReward;
        pact.communityPool = (subjectBond * BREACHED_BOND_TO_COMMUNITY_BPS) / BPS;
        pact.insurancePool = pact.commitPool + subjectBond - pact.rewardPool - pact.communityPool;

        _payTreasury(id, communityTreasury, pact.communityPool, "community");
        _payTreasury(id, insuranceTreasury, pact.insurancePool, "insurance");
    }

    function _payTreasury(bytes32 id, address treasury, uint256 amount, string memory bucket) internal {
        if (amount == 0) return;
        (bool ok,) = treasury.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit TreasuryPaid(id, treasury, amount, bucket);
    }

    function claim(bytes32 id) external nonReentrant onlyExisting(id) {
        Pact storage pact = pacts[id];
        if (!pact.settled) revert NotSettled();
        if (claimed[id][msg.sender]) revert NothingToClaim();

        Side winSide = pact.outcome == Outcome.Kept ? Side.Commit : Side.Skeptic;
        uint256 myStake = stakeOf[id][winSide][msg.sender];
        if (myStake == 0) revert NothingToClaim();

        claimed[id][msg.sender] = true;
        stakeOf[id][winSide][msg.sender] = 0;

        uint256 winPool = winSide == Side.Commit ? pact.commitPool : pact.skepticPool;
        claimedWinStake[id] += myStake;

        uint256 rewardShare;
        if (claimedWinStake[id] == winPool) {
            rewardShare = pact.rewardPool - rewardPaid[id];
        } else {
            rewardShare = (pact.rewardPool * myStake) / winPool;
            rewardPaid[id] += rewardShare;
        }

        uint256 payout = myStake + rewardShare;

        (bool ok,) = msg.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit Claimed(id, msg.sender, winSide, payout);
    }
}
