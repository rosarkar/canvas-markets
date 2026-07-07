// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CanvasEscrowV0} from "../contracts/CanvasEscrowV0.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] < amount) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract CanvasEscrowV0Test is Test {
    MockUSDC usdc;
    CanvasEscrowV0 escrow;
    address relayer = address(0xBEEF);
    address advertiser = address(0xAD);
    address owner = address(0x01);

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new CanvasEscrowV0(address(usdc), relayer);
        usdc.mint(advertiser, 1_000_000);
        vm.prank(advertiser);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function test_depositBudget_incrementsTotalHeld() public {
        vm.prank(advertiser);
        escrow.depositBudget(1, 100_000);
        assertEq(escrow.campaignBalance(1), 100_000);
        assertEq(escrow.totalHeld(), 100_000);
    }

    function test_creditDirectDeposit_afterPlainTransfer() public {
        usdc.mint(address(escrow), 50_000);
        vm.prank(relayer);
        escrow.creditDirectDeposit(2, advertiser, 50_000);
        assertEq(escrow.totalHeld(), 50_000);
    }

    function test_releasePayout_decrementsTotalHeld() public {
        vm.prank(advertiser);
        escrow.depositBudget(3, 100_000);
        vm.prank(relayer);
        escrow.releasePayout(3, owner, 40_000);
        assertEq(escrow.campaignBalance(3), 60_000);
        assertEq(escrow.totalHeld(), 60_000);
    }

    function test_refundUnusedBudget() public {
        vm.prank(advertiser);
        escrow.depositBudget(4, 80_000);
        vm.prank(relayer);
        escrow.refundUnusedBudget(4, 30_000);
        assertEq(escrow.campaignBalance(4), 50_000);
        assertEq(usdc.balanceOf(advertiser), 950_000);
    }

    /// Dust-deposit attack: a later depositor must NOT become the refund recipient.
    function test_depositBudget_dustDepositCannotHijackRefund() public {
        address attacker = address(0xBAD);
        usdc.mint(attacker, 10);
        vm.prank(attacker);
        usdc.approve(address(escrow), type(uint256).max);

        vm.prank(advertiser);
        escrow.depositBudget(5, 100_000);
        vm.prank(attacker);
        escrow.depositBudget(5, 1); // dust

        assertEq(escrow.campaignDepositor(5), advertiser);

        vm.prank(relayer);
        escrow.refundUnusedBudget(5, 100_001);
        assertEq(usdc.balanceOf(advertiser), 1_000_001); // refund (incl. dust) to first depositor
        assertEq(usdc.balanceOf(attacker), 9);
    }

    function test_creditDirectDeposit_cannotOverwriteDepositor() public {
        vm.prank(advertiser);
        escrow.depositBudget(6, 100_000);

        usdc.mint(address(escrow), 50_000);
        vm.prank(relayer);
        escrow.creditDirectDeposit(6, address(0xBAD), 50_000);

        assertEq(escrow.campaignDepositor(6), advertiser);
    }

    /// Top-ups still add budget normally; only the depositor pointer is frozen.
    function test_depositBudget_topUpStillAddsBudget() public {
        vm.prank(advertiser);
        escrow.depositBudget(7, 100_000);
        vm.prank(advertiser);
        escrow.depositBudget(7, 50_000);
        assertEq(escrow.campaignBalance(7), 150_000);
        assertEq(escrow.campaignDepositor(7), advertiser);
    }
}
