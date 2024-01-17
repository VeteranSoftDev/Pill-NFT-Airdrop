import {
  PublicKey,
  SystemProgram,
  Keypair,
  Commitment,
  Connection,
  RpcResponseAndContext,
  SignatureStatus,
  SimulatedTransactionResponse,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
  Blockhash,
  FeeCalculator,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { AccountLayout,MintLayout, Token, TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  WalletNotConnectedError,
} from '@solana/wallet-adapter-base';
import { programs } from '@metaplex/js';
import axios from "axios"
import { clusterApiUrl } from '@solana/web3.js'
import { Console } from 'console';
import * as anchor from "@project-serum/anchor";
import { publicKey } from '@project-serum/anchor/dist/cjs/utils';

import holders from './Holders.json';

const { metadata: { Metadata } } = programs;

interface BlockhashAndFeeCalculator {
  blockhash: Blockhash;
  feeCalculator: FeeCalculator;
}

const axios_timeout = 5000;
const txTimeoutInMilliseconds = 30000;
// const net : any = process.env.REACT_APP_CHAIN
const net : any = process.env.REACT_APP_SOLANA_HOST;
// let net = clusterApiUrl("mainnet-beta")
let conn = new Connection(net)

interface BlockhashAndFeeCalculator {
  blockhash: Blockhash;
  feeCalculator: FeeCalculator;
}

export const getErrorForTransaction = async (
  connection: Connection,
  txid: string,
) => {
  // wait for all confirmation before geting transaction
  await connection.confirmTransaction(txid, 'max');

  const tx = await connection.getParsedConfirmedTransaction(txid);

  const errors: string[] = [];
  if (tx?.meta && tx.meta.logMessages) {
    tx.meta.logMessages.forEach(log => {
      const regex = /Error: (.*)/gm;
      let m;
      while ((m = regex.exec(log)) !== null) {
        // This is necessary to avoid infinite loops with zero-width matches
        if (m.index === regex.lastIndex) {
          regex.lastIndex++;
        }

        if (m.length > 1) {
          errors.push(m[1]);
        }
      }
    });
  }

  return errors;
};

export enum SequenceType {
  Sequential,
  Parallel,
  StopOnFailure,
}

export async function sendTransactionsWithManualRetry(
  connection: Connection,
  wallet: any,
  instructions: TransactionInstruction[][],
  signers: Keypair[][],
): Promise<(string | undefined)[]> {
  let stopPoint = 0;
  let tries = 0;
  let lastInstructionsLength = null;
  let toRemoveSigners: Record<number, boolean> = {};
  instructions = instructions.filter((instr, i) => {
    if (instr.length > 0) {
      return true;
    } else {
      toRemoveSigners[i] = true;
      return false;
    }
  });
  let ids: string[] = [];
  let filteredSigners = signers.filter((_, i) => !toRemoveSigners[i]);

  while (stopPoint < instructions.length && tries < 3) {
    instructions = instructions.slice(stopPoint, instructions.length);
    filteredSigners = filteredSigners.slice(stopPoint, filteredSigners.length);

    if (instructions.length === lastInstructionsLength) tries = tries + 1;
    else tries = 0;

    try {
      if (instructions.length === 1) {
        const id = await sendTransactionWithRetry(
          connection,
          wallet,
          instructions[0],
          filteredSigners[0],
          'single',
        );
        ids.push(id.txid);
        stopPoint = 1;
      } else {
        const { txs } = await sendTransactions(
          connection,
          wallet,
          instructions,
          filteredSigners,
          SequenceType.StopOnFailure,
          'single',
        );
        ids = ids.concat(txs.map(t => t.txid));
      }
    } catch (e) {
      console.error(e);
    }
    console.log(
      'Died on ',
      stopPoint,
      'retrying from instruction',
      instructions[stopPoint],
      'instructions length is',
      instructions.length,
    );
    lastInstructionsLength = instructions.length;
  }

  return ids;
}

export const sendTransactions = async (
  connection: Connection,
  wallet: any,
  instructionSet: TransactionInstruction[][],
  signersSet: Keypair[][],
  sequenceType: SequenceType = SequenceType.Parallel,
  commitment: Commitment = 'singleGossip',
  successCallback: (txid: string, ind: number) => void = (txid, ind) => {},
  failCallback: (reason: string, ind: number) => boolean = (txid, ind) => false,
  block?: BlockhashAndFeeCalculator,
): Promise<{ number: number; txs: { txid: string; slot: number }[] }> => {
  // console.log("given wallet", wallet)
  if (!wallet.publicKey) throw new WalletNotConnectedError();

  const unsignedTxns: Transaction[] = [];

  if (!block) {
    block = await connection.getRecentBlockhash(commitment);
  }

  for (let i = 0; i < instructionSet.length; i++) {
    const instructions = instructionSet[i];
    const signers = signersSet[i];

    if (instructions.length === 0) {
      continue;
    }

    let transaction = new Transaction();
    instructions.forEach(instruction => {
      // console.log("add instruction", instruction)
      transaction.add(instruction)
      // console.log("transaction", transaction)
    });
    // console.log("before sign", transaction)
    transaction.recentBlockhash = block.blockhash;
    transaction.setSigners(
      // fee payed by the wallet owner
      wallet.publicKey,
      ...signers.map(s => s.publicKey),
    );

    if (signers.length > 0) {
      transaction.partialSign(...signers);
    }

    // console.log("transaction", transaction)

    unsignedTxns.push(transaction);
  }

  // console.log("unsigned txns", unsignedTxns)

  const signedTxns = await wallet.signAllTransactions(unsignedTxns);

  // console.log("signed txns", signedTxns);

  const pendingTxns: Promise<{ txid: string; slot: number }>[] = [];

  let breakEarlyObject = { breakEarly: false, i: 0 };
  console.log(
    'Signed txns length',
    signedTxns.length,
    'vs handed in length',
    instructionSet.length,
  );
  for (let i = 0; i < signedTxns.length; i++) {
    const signedTxnPromise = sendSignedTransaction({
      connection,
      signedTransaction: signedTxns[i],
    });

    signedTxnPromise
      .then(({ txid, slot }) => {
        successCallback(txid, i);
      })
      .catch(reason => {
        // @ts-ignore
        failCallback(signedTxns[i], i);
        if (sequenceType === SequenceType.StopOnFailure) {
          breakEarlyObject.breakEarly = true;
          breakEarlyObject.i = i;
        }
      });

    if (sequenceType !== SequenceType.Parallel) {
      try {
        await signedTxnPromise;
      } catch (e) {
        console.log('Caught failure', e);
        if (breakEarlyObject.breakEarly) {
          console.log('Died on ', breakEarlyObject.i);
          // Return the txn we failed on by index
          return {
            number: breakEarlyObject.i,
            txs: await Promise.all(pendingTxns),
          };
        }
      }
    } else {
      pendingTxns.push(signedTxnPromise);
    }
  }

  if (sequenceType !== SequenceType.Parallel) {
    await Promise.all(pendingTxns);
  }

  return { number: signedTxns.length, txs: await Promise.all(pendingTxns) };
};

export const sendTransaction = async (
  connection: Connection,
  wallet: any,
  instructions: TransactionInstruction[],
  signers: Keypair[],
  awaitConfirmation = true,
  commitment: Commitment = 'singleGossip',
  includesFeePayer: boolean = false,
  block?: BlockhashAndFeeCalculator,
) => {
  if (!wallet.publicKey) throw new WalletNotConnectedError();

  let transaction = new Transaction();
  instructions.forEach(instruction => transaction.add(instruction));
  transaction.recentBlockhash = (
    block || (await connection.getRecentBlockhash(commitment))
  ).blockhash;

  if (includesFeePayer) {
    transaction.setSigners(...signers.map(s => s.publicKey));
  } else {
    transaction.setSigners(
      // fee payed by the wallet owner
      wallet.publicKey,
      ...signers.map(s => s.publicKey),
    );
  }

  if (signers.length > 0) {
    transaction.partialSign(...signers);
  }
  if (!includesFeePayer) {
    transaction = await wallet.signTransaction(transaction);
  }

  const rawTransaction = transaction.serialize();
  let options = {
    skipPreflight: true,
    commitment,
  };

  const txid = await connection.sendRawTransaction(rawTransaction, options);
  let slot = 0;

  if (awaitConfirmation) {
    const confirmation = await awaitTransactionSignatureConfirmation(
      txid,
      DEFAULT_TIMEOUT,
      connection,
      true,
    );

    if (!confirmation)
      throw new Error('Timed out awaiting confirmation on transaction');
    slot = confirmation?.slot || 0;

    if (confirmation?.err) {
      const errors = await getErrorForTransaction(connection, txid);

      console.log(errors);
      throw new Error(`Raw transaction ${txid} failed`);
    }
  }

  return { txid, slot };
};

export const sendTransactionWithRetry = async (
  connection: Connection,
  wallet: any,
  instructions: TransactionInstruction[],
  signers: Keypair[],
  commitment: Commitment = 'singleGossip',
  includesFeePayer: boolean = false,
  block?: BlockhashAndFeeCalculator,
  beforeSend?: () => void,
) => {
  if (!wallet.publicKey) throw new WalletNotConnectedError();

  let transaction = new Transaction();
  instructions.forEach(instruction => transaction.add(instruction));
  transaction.recentBlockhash = (
    block || (await connection.getRecentBlockhash(commitment))
  ).blockhash;

  if (includesFeePayer) {
    transaction.setSigners(...signers.map(s => s.publicKey));
  } else {
    transaction.setSigners(
      // fee payed by the wallet owner
      wallet.publicKey,
      ...signers.map(s => s.publicKey),
    );
  }

  if (signers.length > 0) {
    transaction.partialSign(...signers);
  }
  if (!includesFeePayer) {
    transaction = await wallet.signTransaction(transaction);
  }

  if (beforeSend) {
    beforeSend();
  }

  const { txid, slot } = await sendSignedTransaction({
    connection,
    signedTransaction: transaction,
  });

  return { txid, slot };
};

export const getUnixTs = () => {
  return new Date().getTime() / 1000;
};

const DEFAULT_TIMEOUT = 30000;

export async function sendSignedTransaction({
  signedTransaction,
  connection,
  timeout = DEFAULT_TIMEOUT,
}: {
  signedTransaction: Transaction;
  connection: Connection;
  sendingMessage?: string;
  sentMessage?: string;
  successMessage?: string;
  timeout?: number;
}): Promise<{ txid: string; slot: number }> {
  const rawTransaction = signedTransaction.serialize();
  const startTime = getUnixTs();
  let slot = 0;
  const txid: TransactionSignature = await connection.sendRawTransaction(
    rawTransaction,
    {
      skipPreflight: true,
    },
  );

  console.log('Started awaiting confirmation for', txid);

  let done = false;
  (async () => {
    while (!done && getUnixTs() - startTime < timeout) {
      connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
      });
      await sleep(500);
    }
  })();
  try {
    const confirmation = await awaitTransactionSignatureConfirmation(
      txid,
      timeout,
      connection,
      true,
    );

    if (!confirmation)
      throw new Error('Timed out awaiting confirmation on transaction');

    if (confirmation.err) {
      console.error(confirmation.err);
      throw new Error('Transaction failed: Custom instruction error');
    }

    slot = confirmation?.slot || 0;
  } catch (err: any) {
    console.error('Timeout Error caught', err);
    if (err.timeout) {
      throw new Error('Timed out awaiting confirmation on transaction');
    }
    let simulateResult: SimulatedTransactionResponse | null = null;
    try {
      simulateResult = (
        await simulateTransaction(connection, signedTransaction, 'single')
      ).value;
    } catch (e) {}
    if (simulateResult && simulateResult.err) {
      if (simulateResult.logs) {
        for (let i = simulateResult.logs.length - 1; i >= 0; --i) {
          const line = simulateResult.logs[i];
          if (line.startsWith('Program log: ')) {
            throw new Error(
              'Transaction failed: ' + line.slice('Program log: '.length),
            );
          }
        }
      }
      throw new Error(JSON.stringify(simulateResult.err));
    }
    // throw new Error('Transaction failed');
  } finally {
    done = true;
  }

  console.log('Latency', txid, getUnixTs() - startTime);
  return { txid, slot };
}

async function simulateTransaction(
  connection: Connection,
  transaction: Transaction,
  commitment: Commitment,
): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> {
  // @ts-ignore
  transaction.recentBlockhash = await connection._recentBlockhash(
    // @ts-ignore
    connection._disableBlockhashCaching,
  );

  const signData = transaction.serializeMessage();
  // @ts-ignore
  const wireTransaction = transaction._serialize(signData);
  const encodedTransaction = wireTransaction.toString('base64');
  const config: any = { encoding: 'base64', commitment };
  const args = [encodedTransaction, config];

  // @ts-ignore
  const res = await connection._rpcRequest('simulateTransaction', args);
  if (res.error) {
    throw new Error('failed to simulate transaction: ' + res.error.message);
  }
  return res.result;
}

export const awaitTransactionSignatureConfirmation = async (
  txid: anchor.web3.TransactionSignature,
  timeout: number,
  connection: anchor.web3.Connection,
  queryStatus = false,
): Promise<anchor.web3.SignatureStatus | null | void> => {
  let done = false;
  let status: anchor.web3.SignatureStatus | null | void = {
    slot: 0,
    confirmations: 0,
    err: null,
  };
  let subId = 0;
  status = await new Promise(async (resolve, reject) => {
    setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      console.log('Rejecting for timeout...');
      reject({ timeout: true });
    }, timeout);

    while (!done && queryStatus) {
      // eslint-disable-next-line no-loop-func
      (async () => {
        try {
          const signatureStatuses = await connection.getSignatureStatuses([
            txid,
          ]);
          status = signatureStatuses && signatureStatuses.value[0];
          if (!done) {
            if (!status) {
              console.log('REST null result for', txid, status);
            } else if (status.err) {
              console.log('REST error for', txid, status);
              done = true;
              reject(status.err);
            } else if (!status.confirmations) {
              console.log('REST no confirmations for', txid, status);
            } else {
              console.log('REST confirmation for', txid, status);
              done = true;
              resolve(status);
            }
          }
        } catch (e) {
          if (!done) {
            console.log('REST connection error: txid', txid, e);
          }
        }
      })();
      await sleep(2000);
    }
  });

  //@ts-ignore
  if (connection._signatureSubscriptions[subId]) {
    connection.removeSignatureListener(subId);
  }
  done = true;
  console.log('Returning status', status);
  return status;
};

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getNftsForOwner(
  // conn : any,
  owner : PublicKey
  ){

  console.log("+ getNftsForOwner")

  const allnfts: any = [];

  const nftAccounts: any = [];

  const verifiednfts: any = []

  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(owner, {programId: TOKEN_PROGRAM_ID});

  // console.log("token accounts", tokenAccounts);

  let tokenAccount, tokenAmount;

  for (let index = 0; index < tokenAccounts.value.length; index++) {
    tokenAccount = tokenAccounts.value[index];
    tokenAmount = tokenAccount.account.data.parsed.info.tokenAmount;
    if (tokenAmount.amount == '1' && tokenAmount.decimals == 0) {
      const nftMint = new PublicKey(tokenAccount.account.data.parsed.info.mint)
      let tokenmetaPubkey = await Metadata.getPDA(nftMint);
      allnfts.push(tokenmetaPubkey)
      nftAccounts.push(tokenAccounts.value[index].pubkey)
    }
  }

  let nftinfo: any[] = [];

  const buffer = [...allnfts];

  let count = 100;

  const len = Math.floor(buffer.length / 100) + 1;
  let j = 0;
  while(buffer.length > 0) {
    if(buffer.length < 100) {
      count = buffer.length;
    } else {
      count = 100;
    }
    nftinfo = [...nftinfo.concat(await conn.getMultipleAccountsInfo(buffer.splice(0, count)))];
    j++;
  }

  // console.log("nft info", nftinfo);

  // let tokenCount = nftinfo.length

  for(let i = 0; i < nftinfo.length; i++) {
    
    if(nftinfo[i] == null) {
      continue;
    }

    let metadata : any = new Metadata(owner.toBase58(), nftinfo[i])
    // console.log("creator", metadata.data.data.creators)
    if(!metadata.data.data.creators) {
      continue;
    }

    // console.log("metadata", metadata.data.data.creators[0].address, metadata.data.mint)

    if(metadata.data.data.symbol.includes(process.env.REACT_APP_NFT_SYMBOL) && metadata.data.data.creators[0].address == process.env.REACT_APP_NFT_CREATOR){

      let data: any;

      // try {
      //   data = await axios.get(metadata.data.data.uri, {timeout: axios_timeout});
      // } catch(error) {
      //   console.log(error);
      //   continue;
      // }

      // // console.log("data loaded", data)

      // if(!data) {
      //   // console.log("data error")
      //   continue;
      // }

      // const entireData = { ...data.data, id: Number(data.data.name.replace( /^\D+/g, '').split(' - ')[0])}

      let nftMint = new PublicKey(metadata.data.mint)

      // verifiednfts.push({ data : metadata.data, offChainData : entireData })
      verifiednfts.push(metadata.data.mint);
    }
  }

  // verifiednfts.sort(function (a: any, b: any) {
  //   if (a.name < b.name) { return -1; }
  //   if (a.name > b.name) { return 1; }
  //   return 0;
  // })

  return verifiednfts
}

// export async function getNftsForOwner(
//   owner : PublicKey,
//   setLoadingProgress : any
//   ){
//   setLoadingProgress(0);
//   const allTokens: any[] = []
//   const tokenAccounts = await conn.getParsedTokenAccountsByOwner(owner, {
//     programId: TOKEN_PROGRAM_ID
//   });
//   for (let index = 0; index < tokenAccounts.value.length; index++) {
//     setLoadingProgress(Math.floor(index * 100 / tokenAccounts.value.length));
//     try{
//     const tokenAccount = tokenAccounts.value[index];
//     const tokenAmount = tokenAccount.account.data.parsed.info.tokenAmount;

//     if (tokenAmount.amount === "1" && tokenAmount.decimals == "0") {
//       let nftMint = new PublicKey(tokenAccount.account.data.parsed.info.mint)
//       let pda = await getMetadata(nftMint)
//       const accountInfo: any = await conn.getParsedAccountInfo(pda);
//       let metadata : any = new Metadata(owner.toString(), accountInfo.value);
//       const { data }: any = await axios.get(metadata.data.data.uri)
//       if(metadata.data.data.symbol.includes(process.env.REACT_APP_NFT_SYMBOL)){
//         const entireData = { ...data, id: Number(data.name.replace( /^\D+/g, '').split(' - ')[0]) }
//         allTokens.push({data : metadata.data, offChainData : entireData })
//       }
//     }
//     allTokens.sort(function (a: any, b: any) {
//       if (a.name < b.name) { return -1; }
//       if (a.name > b.name) { return 1; }
//       return 0;
//     })
//     } catch(err) {
//     continue;
//     }
//   }
//   // console.log(allTokens)
//   setLoadingProgress(100);
//   return allTokens
// }

const getTokenWallet = async (owner: PublicKey,mint: PublicKey) => {
  return (
    await PublicKey.findProgramAddress(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  )[0];
}


const createAssociatedTokenAccountInstruction = (
  associatedTokenAddress: PublicKey,
  payer: PublicKey,
  walletAddress: PublicKey,
  splTokenMintAddress: PublicKey
  ) => {
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedTokenAddress, isSigner: false, isWritable: true },
    { pubkey: walletAddress, isSigner: false, isWritable: false },
    { pubkey: splTokenMintAddress, isSigner: false, isWritable: false },
    {
      pubkey: anchor.web3.SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: anchor.web3.SYSVAR_RENT_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
  ];
  return new anchor.web3.TransactionInstruction({
    keys,
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.from([]),
  });
}

export const sendNFT = async (wallet: Keypair, mintAddress: string[]) => {
  // console.log(wallet, Keypair)
  try {
    // const transaction = new Transaction();
    const signersMatrix: any[] = [];
    const instructionsMatrix: any[] = [];
    let instructionsMatrixIndex = 0;
    const users = Object.keys(holders);

    let key_index = 0, user_index = 0, user_nft_index = 0, transaction_index = 0;

    signersMatrix.push([]);
    instructionsMatrix.push([]);

    for (const _m of mintAddress) {
      const res = await fetch(process.env.REACT_APP_SOLANA_HOST as string, {
        body: `{
            "jsonrpc":"2.0", 
            "id":1, 
            "method":"getProgramAccounts", 
            "params":[
              "${TOKEN_PROGRAM_ID}",
              {
                "encoding": "jsonParsed",
                "filters": [
                  {
                    "dataSize": 165
                  },
                  {
                    "memcmp": {
                      "offset": 0,
                      "bytes": "${_m}"
                    }
                  }
                ]
              }
            ]}
        `,
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const json = await res.json();
      const validAccount = json.result.filter(
        (r: any) => r.account.data.parsed.info.tokenAmount.uiAmount > 0
      )?.[0]?.pubkey;

      const validMint = json.result.filter(
        (r: any) => r.account.data.parsed.info.tokenAmount.uiAmount > 0
      )?.[0]?.account.data.parsed.info.mint;

      // console.log(validAccount, validMint);
      const toPublicKey = new PublicKey(users[user_index]);
      // console.log(toPublicKey.toBase58())
      console.log("nft", users[user_index], holders[users[user_index] as keyof typeof holders].amount)

      let nftTo = await getTokenWallet(toPublicKey, new PublicKey(validMint))
      if((await conn.getAccountInfo(nftTo))==null)
        instructionsMatrix[instructionsMatrixIndex].push(createAssociatedTokenAccountInstruction(nftTo, wallet.publicKey, toPublicKey, new PublicKey(validMint)))

      instructionsMatrix[instructionsMatrixIndex].push(
        Token.createTransferInstruction(
          TOKEN_PROGRAM_ID,
          new PublicKey(validAccount),
          nftTo,
          wallet.publicKey,
          [],
          1
        )
      );
      
      console.log("user_index, user_nft_index, transaction_index, key_index", user_index, user_nft_index, transaction_index, key_index);

      if(user_nft_index >= holders[users[user_index] as keyof typeof holders].amount - 1) {
        user_index++;
        user_nft_index = 0;
      } else user_nft_index++;

      if(transaction_index >= 2 || key_index >= mintAddress.length-1) {
        transaction_index = 0;
        instructionsMatrixIndex++;
        if(key_index < mintAddress.length-1) {
          // console.log("key index, length", keyIndex, allaccounts.length)
          instructionsMatrix.push([]);
          signersMatrix.push([]);
        }
      } else transaction_index++;
      key_index++;
    }

    console.log("instruction", instructionsMatrix)
    
    // const signature = await connection.sendRawTransaction(signed.serialize());
    const sendTxId = ((await sendTransactions(conn, wallet, instructionsMatrix, signersMatrix)).txs.map(t => t.txid))[0];

    console.log("send txid", sendTxId);
    
    let status: any = { err: true };
    status = await awaitTransactionSignatureConfirmation(
      sendTxId,
      txTimeoutInMilliseconds,
      conn,
      true,
    );
    
    console.log("Transfer finished >>>", status);

    return {
      error: null,
      message: sendTxId,
    };
  } catch (e) {
    console.error(e);
    return { error: e };
  }
};