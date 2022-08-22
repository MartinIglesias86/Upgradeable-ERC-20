const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

const initialSupply = 1000000;
const tokenName = 'Tincoin';
const tokenSymbol = 'TIN';

const eip712DomainTypeDefinition = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

const metaTxTypeDefinition = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'data', type: 'bytes' },
];

function getTypedData(typedDataInput) {
  return {
    types: {
      EIP712Domain: eip712DomainTypeDefinition,
      [typedDataInput.primaryType]: metaTxTypeDefinition,
    },
    primaryType: typedDataInput.primaryType,
    domain: typedDataInput.domainValues,
    message: typedDataInput.messageValues,
  }
}

describe("Tincoin token test", () => {
  let tincoinV1;
  let tincoinV2;
  let tincoinV3;
  let tincoinForwarder;
  let deployer;
  let userAccount;
  let receiverAccount;
  let relayerAccount;

  describe("V1 tests", () => {
    before(async () => {
      const availableSigners = await ethers.getSigners();
      deployer = availableSigners[0];

      const Tincoin = await ethers.getContractFactory('TincoinV1');

      //this.tincoinV1 = await Tincoin.deploy(initialSupply);
      tincoinV1 = await upgrades.deployProxy(Tincoin, [initialSupply], { kind: "uups" });
      await tincoinV1.deployed();
    });

    it("Should be named Tincoin", async () => {
      const fetchedTokenName = await tincoinV1.name();
      expect(fetchedTokenName).to.equal(tokenName);
    });

    it("Should have symbol 'TIN'", async () => {
      const fetchedTokenSymbol = await tincoinV1.symbol();
      expect(fetchedTokenSymbol).to.equal(tokenSymbol);
    });

    it("Should have a totalSupply passed in during deployment", async () => {
      const [fetchedTotalSupply, decimals] = await Promise.all([
        tincoinV1.totalSupply(),
        tincoinV1.decimals()
      ]);
      const expectedTotalSupply = ethers.BigNumber.from(initialSupply).mul(ethers.BigNumber.from(10).pow(decimals));
      expect(fetchedTotalSupply.eq(expectedTotalSupply)).to.be.true;
    });
  });

  describe("V2 tests", () => {
    before(async () => {
      userAccount = (await ethers.getSigners())[1];
      const TincoinV2 = await ethers.getContractFactory('TincoinV2');
      tincoinV2 = await upgrades.upgradeProxy(tincoinV1.address, TincoinV2);
      await tincoinV2.deployed();
    });

    it("Should revert when an account other than the owner is trying to mint tokens", async () => {
      const tmpContractRef = await tincoinV2.connect(userAccount);
      try{
        await tmpContractRef.mint(userAccount.address, ethers.BigNumber.from(10).pow(ethers.BigNumber.from(18)));
      } catch (ex) {
        expect(ex.message).to.contain("reverted");
        expect(ex.message).to.contain("Ownable: caller is not the owner");
      }
    });

    it("Should mint tokens when the owner is executing the mint function", async () => {
      const amountToMint = ethers.BigNumber.from(10).pow(ethers.BigNumber.from(18)).mul(ethers.BigNumber.from(10));
      const accountAmountBeforeMint = await tincoinV2.balanceOf(deployer.address);
      const totalSupplyBeforeMint = await tincoinV2.totalSupply();
      await tincoinV2.mint(deployer.address, amountToMint);

      const newAccountAmount = await tincoinV2.balanceOf(deployer.address);
      const newTotalSupply = await tincoinV2.totalSupply();

      expect(newAccountAmount.eq(accountAmountBeforeMint.add(amountToMint))).to.be.true;
      expect(newTotalSupply.eq(totalSupplyBeforeMint.add(amountToMint))).to.be.true;
    });
  });

  describe("V3 tests", () => {
    before(async () => {
      const availableSigners = await ethers.getSigners();
      deployer = availableSigners[0];
      //user account
      userAccount = availableSigners[1];
      // account that will receive the tokens
      receiverAccount = availableSigners[2];
      // account that will act as gas relayer
      relayerAccount = availableSigners[3];

      const TincoinV3 = await ethers.getContractFactory('TincoinV3');
      const TincoinForwarder = await ethers.getContractFactory('TincoinForwarder');

      // deploying the forwarder contract
      tincoinForwarder = await TincoinForwarder.deploy();
      await tincoinForwarder.deployed();

      // deploying token contract
      tincoinV3 = await upgrades.deployProxy(TincoinV3, [initialSupply, tincoinForwarder.address], { kind: "uups" });
      await tincoinV3.deployed();
    });
      it("Transfer tokens from account A to B without account A paying for the gas fees", async () => {
        // using relayer as the transaction sender when executing contract functions
        const forwarderContractTmpInstance = await tincoinForwarder.connect(relayerAccount);
        const { chainId } = await relayerAccount.provider.getNetwork();
        const userAccountA = deployer;
        const userAccountB = receiverAccount;

        // Getting "user" and relayer ETH balance before transaction
        const userAccountAEthersBeforeTx = await userAccountA.getBalance();
        const relayerAccountEthersBeforeTx = await relayerAccount.getBalance();

        // Getting relayer token balance
        const relayerTokensBeforeTx = await tincoinV3.balanceOf(relayerAccount.address);

        // Getting actual user nonce
        const userACurrentNonce = await tincoinForwarder.getNonce(userAccountA.address);
        
        const totalAmountToTransfer = ethers.BigNumber.from(1).mul(ethers.BigNumber.from(10).pow(10));

        // Meta transaction values
        const messageValues = {
          from: userAccountA.address, //using user address
          to: tincoinV3.address, // to token contract address
          nonce: userACurrentNonce.toString(), // actual nonce for user
          data: tincoinV3.interface.encodeFunctionData("transfer", [
            userAccountB.address,
            totalAmountToTransfer,
          ]) // encoding function call for "transfer(address _to, uint256 amount)"
        };

        // Getting typed data so our Meta-Tx structure can be signed
        const typedData = getTypedData({
          domainValues: {
            name: "TincoinForwarder",
            version: "0.0.1",
            chainId: chainId,
            verifyingContract: tincoinForwarder.address,
          },
          primaryType: "MetaTx",
          messageValues,
        });

      // Getting signature for Meta-Tx struct using user keys
      const signedMessage = await ethers.provider.send("eth_signTypedData_v4", [userAccountA.address, typedData]);

      // executing transaction
      await forwarderContractTmpInstance.executeFunction(messageValues, signedMessage);

      // Getting user and relayer ETH balance before transaction
      const userAccountAEthersAfterTx = await userAccountA.getBalance();
      const relayerAccountEthersAfterTx = await relayerAccount.getBalance();

      // Getting user token balance after transaction
      const relayerTokensAfterTx = await tincoinV3.balanceOf(relayerAccount.address);

      // Getting receiver token balance
      const userAccountBtokens = await tincoinV3.balanceOf(userAccountB.address);
      
      // Making sure the receiver got the transferred balance
      expect(userAccountBtokens.eq(totalAmountToTransfer)).to.be.true;

      // Making sure the "user" ETH balance is the same as it was before sending the transaction (it did not have to pay for the transaction fee)
      expect(userAccountAEthersBeforeTx.eq(userAccountAEthersAfterTx)).to.be.true;
      // Making sure the relayer ETH balance decreased because it paid for the transaction fee
      expect(relayerAccountEthersAfterTx.lt(relayerAccountEthersBeforeTx)).to.be.true;
      // Making sure the relayer token balance did not change
      expect(relayerTokensAfterTx.eq(relayerTokensBeforeTx));
      expect(relayerTokensAfterTx.eq(0)).to.be.equal(true);
      expect(relayerTokensBeforeTx.eq(0)).to.be.equal(true);
      });
  });
});
