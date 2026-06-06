// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICredibility {
    enum Outcome {
        Pending,
        Kept,
        Breached
    }

    function onSettle(address subject, Outcome outcome, uint256 bond, uint64 difficultyBps) external;
}
