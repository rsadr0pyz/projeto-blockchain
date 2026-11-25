// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

import "./CoffeeBatch.sol";
import "./ICoffeeRegistry.sol";

/// @title CoffeeRegistry
/// @notice Run by the standards body (the admin). It registers step type ids and
///         creates one CoffeeBatch contract per batch.
///
///         Batches are EIP-1167 minimal proxy clones of a single CoffeeBatch
///         implementation: each new batch is its own contract (own address and
///         storage), but costs a fraction of a full deployment.
///
/// @dev Compatibility: step type ids are append-only and never reused, so every
///      batch's history always points at a definition the standards body can
///      resolve. To change a step's meaning or format, deactivate it and register
///      a new id (or version the `details` encoding itself).
contract CoffeeRegistry is AccessControl, ICoffeeRegistry {
    struct StepType {
        uint32 id;
        bool active; // inactive types cannot be recorded anymore, but stay in history
    }

    /// @notice The code every batch clone runs.
    address public immutable batchImplementation;

    StepType[] private _stepTypes;
    address[] private _batches;
    mapping(address => bool) public isBatch;

    event StepTypeAdded(uint32 indexed stepTypeId);
    event StepTypeActiveChanged(uint32 indexed stepTypeId, bool active);
    event BatchCreated(uint256 indexed batchId, address indexed batch, address indexed producer);
    /// @notice Mirrors every batch's ownership changes, so "batches owned by X" can be found here.
    event BatchOwnershipTransferred(address indexed batch, address indexed from, address indexed to);

    error StepTypeNotFound(uint32 stepTypeId);
    error StepTypeInactive(uint32 stepTypeId);
    error NotABatch(address caller);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        batchImplementation = address(new CoffeeBatch());
    }

    // ─── Step type registry (admin) ──────────────────────────────────────

    /// @notice Registers the next step type id (0, 1, 2, ...). Its meaning lives off-chain.
    function addStepType() external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint32 id) {
        id = uint32(_stepTypes.length);
        _stepTypes.push(StepType(id, true));
        emit StepTypeAdded(id);
    }

    function setStepTypeActive(uint32 stepTypeId, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _stepType(stepTypeId).active = active;
        emit StepTypeActiveChanged(stepTypeId, active);
    }

    function getStepTypes() external view returns (StepType[] memory) {
        return _stepTypes;
    }

    function requireActiveStepType(uint32 stepTypeId) public view {
        if (!_stepType(stepTypeId).active) revert StepTypeInactive(stepTypeId);
    }

    // ─── Batches ─────────────────────────────────────────────────────────

    /// @notice Creates a new batch contract with its first step (e.g. a harvest).
    ///         The caller becomes its producer and owner.
    function createBatch(uint32 stepTypeId, bytes calldata details) external returns (address batch) {
        requireActiveStepType(stepTypeId);

        uint256 batchId = _batches.length;
        batch = Clones.clone(batchImplementation);
        _batches.push(batch);
        isBatch[batch] = true;

        emit BatchCreated(batchId, batch, msg.sender);
        CoffeeBatch(batch).initialize(batchId, msg.sender, stepTypeId, details);
    }

    function batchCount() external view returns (uint256) {
        return _batches.length;
    }

    function batchAt(uint256 batchId) external view returns (address) {
        return _batches[batchId];
    }

    /// @notice Batch addresses in [offset, offset + limit), for paging through many batches.
    function getBatches(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 end = offset + limit;
        if (end > _batches.length) end = _batches.length;
        if (offset >= end) return new address[](0);
        page = new address[](end - offset);
        for (uint256 i; i < page.length; ++i) page[i] = _batches[offset + i];
    }

    function onBatchOwnershipTransferred(address from, address to) external {
        if (!isBatch[msg.sender]) revert NotABatch(msg.sender);
        emit BatchOwnershipTransferred(msg.sender, from, to);
    }

    // ─── Internals ───────────────────────────────────────────────────────

    function _stepType(uint32 stepTypeId) private view returns (StepType storage) {
        if (stepTypeId >= _stepTypes.length) revert StepTypeNotFound(stepTypeId);
        return _stepTypes[stepTypeId];
    }
}
