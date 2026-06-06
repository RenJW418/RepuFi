// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPredicateAdapter {
    enum Outcome {
        Pending,
        Kept,
        Breached
    }

    function check(bytes calldata paramsBlob) external view returns (bool ready, Outcome outcome, bytes32 evidenceHash);
}
