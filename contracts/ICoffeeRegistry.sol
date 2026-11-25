// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

/// @notice What a CoffeeBatch needs from the registry that created it.
interface ICoffeeRegistry {
    /// @dev Reverts if the step type does not exist or is inactive.
    function requireActiveStepType(uint32 stepTypeId) external view;

    /// @dev Called by a batch when its owner changes, so ownership can be indexed in one place.
    function onBatchOwnershipTransferred(address from, address to) external;
}
