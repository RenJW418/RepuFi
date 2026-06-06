// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockMilestone {
    uint256 public immutable deployedAt;

    constructor() {
        deployedAt = block.timestamp;
    }
}
