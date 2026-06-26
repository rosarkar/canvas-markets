// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice USDC escrow for Canvas AI — unaudited, test amounts only.
contract CanvasEscrowV0 {
    IERC20 public immutable usdc;
    address public relayer;

    /// @dev Sum of all campaignBalance entries; invariant: totalHeld == Σ campaignBalance.
    uint256 public totalHeld;

    mapping(uint256 => uint256) public campaignBalance;
    mapping(uint256 => address) public campaignDepositor;

    event BudgetDeposited(uint256 indexed campaignId, address indexed depositor, uint256 amount);
    event BudgetRefunded(uint256 indexed campaignId, address indexed to, uint256 amount);
    event PayoutReleased(uint256 indexed campaignId, address indexed to, uint256 amount);

    error OnlyRelayer();
    error InsufficientBalance();
    error InsufficientUnallocated();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert OnlyRelayer();
        _;
    }

    constructor(address usdcToken, address relayerAddress) {
        usdc = IERC20(usdcToken);
        relayer = relayerAddress;
    }

    function depositBudget(uint256 campaignId, uint256 amount) external {
        require(usdc.transferFrom(msg.sender, address(this), amount), "transfer failed");
        campaignBalance[campaignId] += amount;
        totalHeld += amount;
        campaignDepositor[campaignId] = msg.sender;
        emit BudgetDeposited(campaignId, msg.sender, amount);
    }

    /// @notice Credit USDC that arrived via plain transfer (Base Pay) to a campaign.
    function creditDirectDeposit(uint256 campaignId, address depositor, uint256 amount) external onlyRelayer {
        uint256 free = usdc.balanceOf(address(this)) - totalHeld;
        if (amount > free) revert InsufficientUnallocated();
        campaignBalance[campaignId] += amount;
        totalHeld += amount;
        campaignDepositor[campaignId] = depositor;
        emit BudgetDeposited(campaignId, depositor, amount);
    }

    function releasePayout(uint256 campaignId, address to, uint256 amount) external onlyRelayer {
        if (campaignBalance[campaignId] < amount) revert InsufficientBalance();
        campaignBalance[campaignId] -= amount;
        totalHeld -= amount;
        require(usdc.transfer(to, amount), "transfer failed");
        emit PayoutReleased(campaignId, to, amount);
    }

    /// @notice Return unused campaign budget to the original depositor (advertiser withdraw).
    function refundUnusedBudget(uint256 campaignId, uint256 amount) external onlyRelayer {
        if (amount > campaignBalance[campaignId]) revert InsufficientBalance();
        campaignBalance[campaignId] -= amount;
        totalHeld -= amount;
        address to = campaignDepositor[campaignId];
        require(usdc.transfer(to, amount), "transfer failed");
        emit BudgetRefunded(campaignId, to, amount);
    }

    /// @notice Recover orphaned USDC (pay-after-expiry, etc.) not allocated to any campaign.
    function withdrawUnallocated(address to, uint256 amount) external onlyRelayer {
        uint256 free = usdc.balanceOf(address(this)) - totalHeld;
        if (amount > free) revert InsufficientUnallocated();
        require(usdc.transfer(to, amount), "transfer failed");
    }

    function setRelayer(address newRelayer) external onlyRelayer {
        relayer = newRelayer;
    }
}
