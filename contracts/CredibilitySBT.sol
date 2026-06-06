// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CredibilitySBT is ERC721, Ownable {
    enum Outcome {
        Pending,
        Kept,
        Breached
    }

    struct Profile {
        int256 score;
        uint32 kept;
        uint32 broken;
        uint256 stakedKept;
        uint64 updated;
    }

    uint256 public constant BREACH_PENALTY_BPS = 10_000;

    address public market;
    mapping(address => Profile) public profileOf;

    event MarketSet(address indexed market);
    event CredibilityUpdated(
        address indexed subject,
        bytes32 indexed pactRef,
        Outcome outcome,
        int256 delta,
        uint64 difficultyBps
    );

    error Unauthorized();
    error Soulbound();

    constructor(address initialOwner) ERC721("PACT Credibility", "PACT-SBT") Ownable(initialOwner) {}

    modifier onlyMarket() {
        if (msg.sender != market) revert Unauthorized();
        _;
    }

    function setMarket(address newMarket) external onlyOwner {
        market = newMarket;
        emit MarketSet(newMarket);
    }

    function tokenIdOf(address subject) public pure returns (uint256) {
        return uint256(uint160(subject));
    }

    function getProfile(address subject) external view returns (Profile memory) {
        return profileOf[subject];
    }

    function onSettle(address subject, Outcome outcome, uint256 bond, uint64 difficultyBps) external onlyMarket {
        Profile storage profile = profileOf[subject];
        int256 delta;

        if (outcome == Outcome.Kept) {
            delta = int256((bond * difficultyBps) / 10_000);
            profile.score += delta;
            profile.kept += 1;
            profile.stakedKept += bond;
        } else if (outcome == Outcome.Breached) {
            delta = -int256((bond * BREACH_PENALTY_BPS) / 10_000);
            profile.score += delta;
            profile.broken += 1;
        } else {
            revert Unauthorized();
        }

        profile.updated = uint64(block.timestamp);

        uint256 tokenId = tokenIdOf(subject);
        if (!_ownerExists(tokenId)) {
            _safeMint(subject, tokenId);
        }

        emit CredibilityUpdated(subject, bytes32(tokenId), outcome, delta, difficultyBps);
    }

    function _ownerExists(uint256 tokenId) internal view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
