// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPredicateAdapter} from "../interfaces/IPredicateAdapter.sol";

contract OnchainMilestoneAdapter is IPredicateAdapter {
    bytes32 public constant EVIDENCE_DEPLOYED = keccak256("onchain_milestone:deployed");
    bytes32 public constant EVIDENCE_NOT_DEPLOYED = keccak256("onchain_milestone:not_deployed");

    function check(bytes calldata paramsBlob) external view returns (bool ready, Outcome outcome, bytes32 evidenceHash) {
        address target = abi.decode(paramsBlob, (address));
        bool deployed = target.code.length > 0;
        return (
            true,
            deployed ? Outcome.Kept : Outcome.Breached,
            deployed ? keccak256(abi.encode(EVIDENCE_DEPLOYED, target)) : keccak256(abi.encode(EVIDENCE_NOT_DEPLOYED, target))
        );
    }
}
