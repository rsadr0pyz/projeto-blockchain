// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import "./ICoffeeRegistry.sol";

/// @title CoffeeBatch
/// @notice One coffee batch: its owner, its signed step history and its pending proposals.
///         Created by CoffeeRegistry as a minimal proxy clone; never deployed directly.
///
///         Every step is recorded with the address that sent the transaction:
///         the wallet's signature on the transaction is the proof of who did it.
///
///         Two-party confirmation: a step done by someone other than the owner is
///         first stored as a pending proposal. It only enters the history when the
///         owner confirms it, in a separate transaction, at any later time.
///
///           performer: submitStep(stepType, details) ──► pending #id
///           owner:     confirmStep(id)  ──► step recorded (performer + approver)
///                      rejectStep(id)   ──► proposal deleted
///           performer: cancelStep(id)   ──► proposal deleted
///
///         Steps submitted by the owner are recorded immediately.
///         Step types and the encoding of `details` are defined off-chain by the
///         registry's admin; this contract only checks that the step type is active.
contract CoffeeBatch is Initializable {
    /// @notice A step as proposed. Fixed fields fit in one storage slot (4 + 20 + 8 bytes).
    struct Step {
        uint32 stepTypeId;
        address actor; // who did the step (signed the proposal)
        uint64 proposedAt;
        bytes details; // raw data; encoding defined off-chain per step type
    }

    /// @notice A step in the history: the proposal plus who confirmed it (one more slot).
    struct ApprovedStep {
        Step step;
        address approvedBy; // owner who confirmed it (= actor if the owner did it)
        uint64 confirmedAt;
    }

    ICoffeeRegistry public registry;
    uint256 public batchId; // index in the registry
    address public owner; // who must confirm steps; transferable
    uint64 public createdAt;

    ApprovedStep[] private _steps;

    /// @notice Pending ids start at 1 and are never reused.
    uint256 public pendingCount;
    mapping(uint256 => Step) private _pending;
    uint256[] private _openIds;
    mapping(uint256 => uint256) private _openPos; // pendingId => index in _openIds + 1 (0 = not open)

    event OwnershipTransferred(address indexed from, address indexed to);
    event StepProposed(uint256 indexed pendingId, address indexed proposer, uint32 indexed stepTypeId, bytes details);
    event StepConfirmed(uint256 indexed pendingId, address indexed owner);
    event StepRejected(uint256 indexed pendingId, address indexed owner, bytes reason);
    event StepCancelled(uint256 indexed pendingId, address indexed proposer);
    event StepRecorded(uint32 indexed stepTypeId, address indexed actor, address indexed approvedBy, bytes details);

    error PendingStepNotFound(uint256 pendingId);
    error NotOwner(address caller);
    error NotProposer(uint256 pendingId, address caller);
    error InvalidOwner();

    /// @dev The implementation contract itself can never be initialized; only its clones can.
    constructor() {
        _disableInitializers();
    }

    /// @dev Called once by the registry, in the same transaction that creates the clone.
    ///      The registry has already checked the step type.
    function initialize(uint256 batchId_, address producer_, uint32 stepTypeId, bytes calldata details)
        external
        initializer
    {
        registry = ICoffeeRegistry(msg.sender);
        batchId = batchId_;
        producer = producer_;
        owner = producer_;
        createdAt = uint64(block.timestamp);
        _apply(Step(stepTypeId, producer_, uint64(block.timestamp), details));
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    // ─── Ownership ───────────────────────────────────────────────────────

    /// @notice Hands the batch (and the right to confirm its steps) to someone else, e.g. a buyer.
    ///         Open proposals stay open; the new owner decides on them.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidOwner();
        address from = owner;
        owner = newOwner;
        emit OwnershipTransferred(from, newOwner);
        registry.onBatchOwnershipTransferred(from, newOwner);
    }

    // ─── Steps: propose / confirm ────────────────────────────────────────

    /// @notice Submits a step. If the caller is the owner it is recorded now and 0 is returned;
    ///         otherwise it becomes a pending proposal and its id is returned.
    function submitStep(uint32 stepTypeId, bytes calldata details) external returns (uint256 pendingId) {
        registry.requireActiveStepType(stepTypeId);
        Step memory s = Step(stepTypeId, msg.sender, uint64(block.timestamp), details);

        if (msg.sender == owner) {
            _apply(s);
            return 0;
        }

        pendingId = ++pendingCount;
        _pending[pendingId] = s;
        _openIds.push(pendingId);
        _openPos[pendingId] = _openIds.length;
        emit StepProposed(pendingId, msg.sender, stepTypeId, details);
    }

    /// @notice Owner accepts a proposal. Fails if its step type was deactivated in the meantime.
    function confirmStep(uint256 pendingId) external onlyOwner {
        Step memory s = _openPending(pendingId);
        registry.requireActiveStepType(s.stepTypeId);
        _closePending(pendingId);
        emit StepConfirmed(pendingId, msg.sender);
        _apply(s);
    }

    /// @notice Owner refuses a proposal. The reason is kept only in the event.
    function rejectStep(uint256 pendingId, bytes calldata reason) external onlyOwner {
        _openPending(pendingId);
        _closePending(pendingId);
        emit StepRejected(pendingId, msg.sender, reason);
    }

    /// @notice Proposer withdraws their own proposal.
    function cancelStep(uint256 pendingId) external {
        if (_openPending(pendingId).actor != msg.sender) revert NotProposer(pendingId, msg.sender);
        _closePending(pendingId);
        emit StepCancelled(pendingId, msg.sender);
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function stepCount() external view returns (uint256) {
        return _steps.length;
    }

    function getSteps() external view returns (ApprovedStep[] memory) {
        return _steps;
    }

    function getPendingStep(uint256 pendingId) external view returns (Step memory) {
        return _openPending(pendingId);
    }

    /// @notice Open proposals. Order is not guaranteed: closing a proposal reorders the list.
    function getPendingSteps() external view returns (uint256[] memory ids, Step[] memory steps) {
        ids = _openIds;
        steps = new Step[](ids.length);
        for (uint256 i; i < ids.length; ++i) steps[i] = _pending[ids[i]];
    }

    // ─── Internals ───────────────────────────────────────────────────────

    /// @dev Appends a step approved by the current owner.
    function _apply(Step memory s) private {
        _steps.push(ApprovedStep(s, owner, uint64(block.timestamp)));
        emit StepRecorded(s.stepTypeId, s.actor, owner, s.details);
    }

    /// @dev Deletes the proposal (storage refund) and removes it from the open list (swap and pop).
    function _closePending(uint256 pendingId) private {
        uint256 index = _openPos[pendingId] - 1;
        uint256 lastId = _openIds[_openIds.length - 1];
        _openIds[index] = lastId;
        _openPos[lastId] = index + 1;
        _openIds.pop();
        delete _openPos[pendingId];
        delete _pending[pendingId];
    }

    function _openPending(uint256 pendingId) private view returns (Step storage) {
        if (_openPos[pendingId] == 0) revert PendingStepNotFound(pendingId);
        return _pending[pendingId];
    }
}
