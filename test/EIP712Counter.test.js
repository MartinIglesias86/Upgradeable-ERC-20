const { expect } = require('chai');
const { ethers } = require('hardhat');

const eip712DomainTypeDefinition = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

const signatureTypeDefinition = [
  { name: 'signer', type: 'address' },
  { name: 'message', type: 'string' },
];
/*
typedDataInput
{
  domainValues: {
    name: <string>,
    version: <string>,
    chainId: <uint256>,
    verifyingContract: <string>,
  },
  primaryType: "Signature",
  messageValues: {
    signer: <string>,
    message: <string>,
  }
}
*/

// Getting typed data
function getTypedData(typedDataInput) {
  return {
    types: {
      EIP712Domain: eip712DomainTypeDefinition,
      [typedDataInput.primaryType]: signatureTypeDefinition,
    },
    primaryType: typedDataInput.primaryType,
    domain: typedDataInput.domainValues,
    message: typedDataInput.messageValues,
  };
}

describe("EIP712Counter test", () => {
  let counterContract;
  let deployer;
  let relayerAccount;

  before(async () => {
    const availableSigners = await ethers.getSigners();
    deployer = availableSigners[0];
    // relayer account will pay for transaction fees
    relayerAccount = availableSigners[1];

    // Deploying the contract
    const EIP712Counter = await ethers.getContractFactory('EIP712MessageCounter');
    counterContract = await EIP712Counter.deploy();
    await counterContract.deployed();
    counterContract.address
  });

  it("Should allow a gas relayer send a transaction on behalf of some other account", async () => {
    // using relayer as the account that sends the transaction
    const counterTmpInstance = await counterContract.connect(relayerAccount);
    // getting the chain id to be used in the domain separator
    const { chainId } = await relayerAccount.provider.getNetwork();
    // getting relayer and 'user' ETH balance before the transaction
    const relayerEthBeforeTx = await relayerAccount.getBalance();
    const deployerEthBeforeTx = await deployer.getBalance();
    const signatureMessage = {
      signer: deployer.address,
      message: "First Message",
    };

    // getting the typed data
    const typedData = getTypedData({
      domainValues: {
        name: "EIP712MessageCounter",
        version: "0.0.1",
        chainId: chainId,
        verifyingContract: counterTmpInstance.address,
      },
      primaryType: "Signature",
      messageValues: signatureMessage,
    });

    // using web3 provider to sign the structure with the "user's" key
    const signedMessage = await ethers.provider.send('eth_signTypedData_v4', [deployer.address, typedData]);

    // sending the transaction to the network (relayer as the sender)
    await counterTmpInstance.setSignerMessage(signatureMessage, signedMessage);

    // getting that the last sent message was the one we just embedded in the transaction
    const lastStoredMessageForAccount = await counterTmpInstance.lastMessageOf(deployer.address);
    // getting the message count for the user
    const messageCountForAccount = await counterTmpInstance.countOf(deployer.address);

    // getting last sent message for the relayer
    const lastStoredMessageForRelayer = await counterTmpInstance.lastMessageOf(relayerAccount.address);
    // getting the message count for the relayer
    const messageCountForRelayer = await counterTmpInstance.countOf(relayerAccount.address);

    // getting the relayer and 'user' ETH balance after the transaction
    const relayerEthAfterTx = await relayerAccount.getBalance();
    const deployerEthAfterTx = await deployer.getBalance();

    // making sure the last message for the user is equal to the embedded message in the transaction
    expect(lastStoredMessageForAccount).to.equal(signatureMessage.message);
    // making sure the message count for the user is equal to 1
    expect(messageCountForAccount.eq(ethers.BigNumber.from(1))).to.be.true;

    // making sure the last message for the relayer is empty despite being the account that sent the transaction
    expect(lastStoredMessageForRelayer).to.be.equal("");
    // making sure the message count for the relayer is equal to 0
    expect(messageCountForRelayer.eq(ethers.BigNumber.from(0))).to.be.true;

    // making sure the relayer balance has decreased by the gas cost of the transaction
    expect(relayerEthAfterTx.lt(relayerEthBeforeTx)).to.be.true;
    // making sure the deployer balance did not change
    expect(deployerEthBeforeTx.eq(deployerEthAfterTx)).to.be.true;
  });
});