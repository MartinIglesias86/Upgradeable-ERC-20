// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract TincoinV2 is
  ERC20Upgradeable,
  OwnableUpgradeable,
  UUPSUpgradeable
{
  function initialize(uint256 initialSupply) public initializer {
    __ERC20_init("Tincoin", "TIN");
    __Ownable_init_unchained();
    __UUPSUpgradeable_init();
    _mint(msg.sender, initialSupply * (10**decimals()));
  }

  function _authorizeUpgrade(address nemImplementation) internal override onlyOwner {}

  // New function that can only be executed by the contract owner
  function mint(address toAccount, uint256 amount) public onlyOwner {
    _mint(toAccount, amount);
  }
}