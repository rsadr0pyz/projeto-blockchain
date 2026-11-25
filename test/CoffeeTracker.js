const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

// The contracts only know ids; this mapping is what the standards body would publish off-chain.
const Step = { Harvest: 0, Sorting: 1, Drying: 2, Roasting: 3 };
const raw = (text) => ethers.utils.toUtf8Bytes(text); // any bytes work; text is just easy to read in tests
const hex = (text) => ethers.utils.hexlify(raw(text));

describe("CoffeeRegistry + CoffeeBatch", function () {
  async function deployFixture() {
    const [admin, farmer, processor, roaster, buyer, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CoffeeRegistry");
    const registry = await Registry.deploy();
    await registry.deployed();

    for (let i = 0; i < Object.keys(Step).length; i++) await registry.addStepType();

    // Batch #0, created (and owned) by the farmer.
    await registry.connect(farmer).createBatch(Step.Harvest, raw("Lot A"));
    const batch = await ethers.getContractAt("CoffeeBatch", await registry.batchAt(0));

    return { registry, batch, admin, farmer, processor, roaster, buyer, stranger };
  }

  /** performer proposes, owner confirms. Returns the confirm transaction. */
  async function proposeAndConfirm(batch, owner, performer, stepTypeId, details = "0x") {
    await batch.connect(performer).submitStep(stepTypeId, details);
    return batch.connect(owner).confirmStep(await batch.pendingCount());
  }

  describe("registry", function () {
    it("assigns sequential step type ids", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.addStepType()).to.emit(registry, "StepTypeAdded").withArgs(4);
      const types = await registry.getStepTypes();
      expect(types.map((t) => t.id)).to.deep.equal([0, 1, 2, 3, 4]);
      expect(types.every((t) => t.active)).to.equal(true);
    });

    it("only lets the admin change step types", async function () {
      const { registry, stranger } = await loadFixture(deployFixture);
      await expect(registry.connect(stranger).addStepType()).to.be.revertedWith(/AccessControl/);
      await expect(registry.connect(stranger).setStepTypeActive(0, false)).to.be.revertedWith(/AccessControl/);
    });

    it("creates each batch as its own contract", async function () {
      const { registry, batch, farmer, processor } = await loadFixture(deployFixture);

      const tx = registry.connect(processor).createBatch(Step.Harvest, raw("Lot B"));
      await expect(tx).to.emit(registry, "BatchCreated").withArgs(1, anyValue, processor.address);

      const second = await ethers.getContractAt("CoffeeBatch", await registry.batchAt(1));
      const { events } = await (await tx).wait();
      expect(events.find((e) => e.event === "BatchCreated").args.batch).to.equal(second.address);
      expect(second.address).to.not.equal(batch.address);
      expect(await registry.batchCount()).to.equal(2);
      expect(await registry.getBatches(0, 10)).to.deep.equal([batch.address, second.address]);
      expect(await registry.getBatches(1, 10)).to.deep.equal([second.address]);
      expect(await registry.getBatches(5, 10)).to.deep.equal([]);
      expect(await registry.isBatch(second.address)).to.equal(true);

      // Independent state.
      expect(await batch.owner()).to.equal(farmer.address);
      expect(await second.owner()).to.equal(processor.address);
      expect(await second.batchId()).to.equal(1);
      expect(await second.registry()).to.equal(registry.address);
    });

    it("rejects batches with unknown or inactive step types", async function () {
      const { registry, farmer } = await loadFixture(deployFixture);
      await expect(registry.connect(farmer).createBatch(99, "0x"))
        .to.be.revertedWithCustomError(registry, "StepTypeNotFound")
        .withArgs(99);
      await registry.setStepTypeActive(Step.Harvest, false);
      await expect(registry.connect(farmer).createBatch(Step.Harvest, "0x")).to.be.revertedWithCustomError(
        registry,
        "StepTypeInactive"
      );
    });

    it("only accepts ownership notifications from its batches", async function () {
      const { registry, stranger } = await loadFixture(deployFixture);
      await expect(registry.connect(stranger).onBatchOwnershipTransferred(stranger.address, stranger.address))
        .to.be.revertedWithCustomError(registry, "NotABatch")
        .withArgs(stranger.address);
    });
  });

  describe("batch setup", function () {
    it("records the creator as producer, owner and first step", async function () {
      const { batch, farmer } = await loadFixture(deployFixture);
      expect(await batch.producer()).to.equal(farmer.address);
      expect(await batch.owner()).to.equal(farmer.address);
      const [first] = await batch.getSteps();
      expect(first.step.stepTypeId).to.equal(Step.Harvest);
      expect(first.step.actor).to.equal(farmer.address);
      expect(first.step.details).to.equal(hex("Lot A"));
      expect(first.approvedBy).to.equal(farmer.address);
    });

    it("cannot be initialized again, and the implementation cannot be initialized at all", async function () {
      const { registry, batch, stranger } = await loadFixture(deployFixture);
      await expect(batch.connect(stranger).initialize(0, stranger.address, 0, "0x")).to.be.revertedWith(
        /already initialized/
      );
      const impl = await ethers.getContractAt("CoffeeBatch", await registry.batchImplementation());
      await expect(impl.initialize(0, stranger.address, 0, "0x")).to.be.revertedWith(/already initialized/);
    });
  });

  describe("raw details", function () {
    it("stores and returns details byte for byte", async function () {
      const { batch, farmer, processor } = await loadFixture(deployFixture);
      const binary = "0x00ff0102deadbeef" + "ab".repeat(100); // arbitrary binary, including zero bytes

      await expect(batch.connect(processor).submitStep(Step.Drying, binary))
        .to.emit(batch, "StepProposed")
        .withArgs(1, processor.address, Step.Drying, binary);
      expect((await batch.getPendingStep(1)).details).to.equal(binary);

      await expect(batch.connect(farmer).confirmStep(1))
        .to.emit(batch, "StepRecorded")
        .withArgs(Step.Drying, processor.address, farmer.address, binary);
      expect((await batch.getSteps())[1].step.details).to.equal(binary);
    });

    it("accepts empty details", async function () {
      const { batch, farmer } = await loadFixture(deployFixture);
      await batch.connect(farmer).submitStep(Step.Sorting, "0x");
      expect((await batch.getSteps())[1].step.details).to.equal("0x");
    });
  });

  describe("two-party confirmation", function () {
    it("records performer and approver of each step", async function () {
      const { batch, farmer, processor, roaster } = await loadFixture(deployFixture);
      await proposeAndConfirm(batch, farmer, processor, Step.Sorting);
      await proposeAndConfirm(batch, farmer, processor, Step.Drying);
      await proposeAndConfirm(batch, farmer, roaster, Step.Roasting);

      const steps = await batch.getSteps();
      expect(await batch.stepCount()).to.equal(4);
      expect(steps.map((s) => s.step.stepTypeId)).to.deep.equal([Step.Harvest, Step.Sorting, Step.Drying, Step.Roasting]);
      expect(steps.map((s) => s.step.actor)).to.deep.equal([
        farmer.address, processor.address, processor.address, roaster.address,
      ]);
      expect(steps.every((s) => s.approvedBy === farmer.address)).to.equal(true);
      expect(steps.every((s) => s.confirmedAt.gte(s.step.proposedAt))).to.equal(true);
    });

    it("keeps a proposal pending until the owner confirms it", async function () {
      const { batch, farmer, processor } = await loadFixture(deployFixture);
      await batch.connect(processor).submitStep(Step.Drying, raw("sun"));

      expect(await batch.stepCount()).to.equal(1);
      expect((await batch.getPendingStep(1)).actor).to.equal(processor.address);
      expect((await batch.getPendingSteps()).ids).to.deep.equal([1]);

      await expect(batch.connect(farmer).confirmStep(1)).to.emit(batch, "StepConfirmed").withArgs(1, farmer.address);

      expect(await batch.stepCount()).to.equal(2);
      expect((await batch.getPendingSteps()).ids).to.deep.equal([]);
      await expect(batch.getPendingStep(1)).to.be.revertedWithCustomError(batch, "PendingStepNotFound");
      await expect(batch.connect(farmer).confirmStep(1)).to.be.revertedWithCustomError(batch, "PendingStepNotFound");
    });

    it("records the owner's own steps immediately", async function () {
      const { batch, farmer } = await loadFixture(deployFixture);
      await expect(batch.connect(farmer).submitStep(Step.Drying, "0x"))
        .to.emit(batch, "StepRecorded")
        .withArgs(Step.Drying, farmer.address, farmer.address, "0x");
      expect(await batch.pendingCount()).to.equal(0);
    });

    it("only lets the owner confirm or reject", async function () {
      const { batch, processor, stranger } = await loadFixture(deployFixture);
      await batch.connect(processor).submitStep(Step.Sorting, "0x");
      await expect(batch.connect(processor).confirmStep(1)).to.be.revertedWithCustomError(batch, "NotOwner");
      await expect(batch.connect(stranger).rejectStep(1, "0x")).to.be.revertedWithCustomError(batch, "NotOwner");
    });

    it("lets the owner reject and the proposer cancel", async function () {
      const { batch, farmer, processor, stranger } = await loadFixture(deployFixture);
      await batch.connect(processor).submitStep(Step.Sorting, raw("a"));
      await batch.connect(processor).submitStep(Step.Sorting, raw("b"));
      await batch.connect(processor).submitStep(Step.Drying, raw("c"));

      await expect(batch.connect(farmer).rejectStep(1, raw("wrong lot")))
        .to.emit(batch, "StepRejected")
        .withArgs(1, farmer.address, hex("wrong lot"));

      await expect(batch.connect(stranger).cancelStep(3)).to.be.revertedWithCustomError(batch, "NotProposer");
      await expect(batch.connect(processor).cancelStep(3)).to.emit(batch, "StepCancelled").withArgs(3, processor.address);

      const { ids, steps } = await batch.getPendingSteps();
      expect(ids).to.deep.equal([2]);
      expect(steps[0].details).to.equal(hex("b"));
      expect(await batch.stepCount()).to.equal(1);
    });

    it("checks step types against the registry", async function () {
      const { registry, batch, farmer, processor } = await loadFixture(deployFixture);
      await expect(batch.connect(processor).submitStep(99, "0x"))
        .to.be.revertedWithCustomError(registry, "StepTypeNotFound")
        .withArgs(99);

      await batch.connect(processor).submitStep(Step.Sorting, "0x");
      await registry.setStepTypeActive(Step.Sorting, false);
      await expect(batch.connect(processor).submitStep(Step.Sorting, "0x")).to.be.revertedWithCustomError(
        registry,
        "StepTypeInactive"
      );
      // A proposal made before deactivation can no longer be confirmed, only rejected.
      await expect(batch.connect(farmer).confirmStep(1)).to.be.revertedWithCustomError(registry, "StepTypeInactive");
      await batch.connect(farmer).rejectStep(1, "0x");
    });

    it("transfers ownership, mirrored in the registry", async function () {
      const { registry, batch, farmer, processor, buyer } = await loadFixture(deployFixture);
      await batch.connect(processor).submitStep(Step.Sorting, "0x");

      await expect(batch.connect(buyer).transferOwnership(buyer.address)).to.be.revertedWithCustomError(batch, "NotOwner");
      await expect(
        batch.connect(farmer).transferOwnership(ethers.constants.AddressZero)
      ).to.be.revertedWithCustomError(batch, "InvalidOwner");

      const tx = batch.connect(farmer).transferOwnership(buyer.address);
      await expect(tx).to.emit(batch, "OwnershipTransferred").withArgs(farmer.address, buyer.address);
      await expect(tx)
        .to.emit(registry, "BatchOwnershipTransferred")
        .withArgs(batch.address, farmer.address, buyer.address);

      await expect(batch.connect(farmer).confirmStep(1)).to.be.revertedWithCustomError(batch, "NotOwner");
      await batch.connect(buyer).confirmStep(1);

      expect(await batch.owner()).to.equal(buyer.address);
      expect(await batch.producer()).to.equal(farmer.address);
      expect((await batch.getSteps())[1].approvedBy).to.equal(buyer.address);
    });
  });
});
