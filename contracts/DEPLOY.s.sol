// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

// Paste these into your Foundry project's src/ directory along with the contracts

/*
  DEPLOYMENT ORDER:
  
  1. Deploy ZeroToken
  2. Deploy GridZeroV2 (passing USDC, ZeroToken, fulfiller, feeRecipient)
  3. Call ZeroToken.setMinter(GridZeroV2.address, true)
  
  BASE MAINNET ADDRESSES:
  - USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  
  COMMANDS:
  
  forge create src/ZeroToken.sol:ZeroToken \
    --rpc-url https://mainnet.base.org \
    --private-key $DEPLOYER_KEY \
    --verify --etherscan-api-key $BASESCAN_KEY

  forge create src/GridZeroV2.sol:GridZeroV2 \
    --rpc-url https://mainnet.base.org \
    --private-key $DEPLOYER_KEY \
    --constructor-args \
      0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \  # USDC on Base
      <ZERO_TOKEN_ADDRESS> \
      <RESOLVER_BOT_ADDRESS> \
      <FEE_RECIPIENT_ADDRESS> \
    --verify --etherscan-api-key $BASESCAN_KEY

  # Then set GridZeroV2 as minter on ZeroToken:
  cast send <ZERO_TOKEN_ADDRESS> \
    "setMinter(address,bool)" <GRIDZERO_V2_ADDRESS> true \
    --rpc-url https://mainnet.base.org \
    --private-key $DEPLOYER_KEY
*/
