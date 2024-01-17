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
import {AccountLayout,MintLayout,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,Token} from "@solana/spl-token";
import useNotify from './notify'
// import {sendTransactionWithRetry} from './utility'
import * as bs58 from 'bs58'
import * as anchor from "@project-serum/anchor";
import { programs } from '@metaplex/js';
import axios from "axios"

import {WalletConnect, WalletDisconnect} from '../wallet'
import { Container, Snackbar } from '@material-ui/core';
import Alert from '@material-ui/lab/Alert';
import { CircularProgress, Card, CardMedia, Grid, CardContent, Typography, BottomNavigation,
				Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper  } from '@mui/material'

let wallet : any
let conn = new Connection(clusterApiUrl('devnet'))
let notify: any

const { metadata: { Metadata } } = programs
const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
const programId = new PublicKey('AiAK8Z8eBPmtH9uGVawmZCvyYhnkmngsuvQEJAPV8Rdf')
const idl = require('./solana_anchor.json')
const confirmOption : ConfirmOptions = {commitment : 'finalized',preflightCommitment : 'finalized',skipPreflight : false}

interface Schedule{
	time : string;
	amount : string;
}

let defaultSchedule = {
	time : '', amount : ''
}

interface AlertState {
  open: boolean;
  message: string;
  severity: 'success' | 'info' | 'warning' | 'error' | undefined;
}

export default function Airdrop(){
	wallet = useWallet()
	notify = useNotify()

	const [pool, setPool] = useState('HHysdna6jSGcJtAAacTGpNcLjyMput1qDxyz7FwDwnAu')
	const [poolData, setPoolData] = useState<any>(null)
	const [tAmount, setTAmount] = useState(0)
	const [holdingNfts, setHoldingNfts] = useState<any[]>([])
	const [airdropAble, setAirdropAble] = useState<any>({confirmed : false, start : 0})
  const [alertState, setAlertState] = useState<AlertState>({open: false,message: '',severity: undefined})
  const [isLoading, setIsLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [tableShow, setTableShow] = useState(false)

	const createAssociatedTokenAccountInstruction = (
	  associatedTokenAddress: anchor.web3.PublicKey,
	  payer: anchor.web3.PublicKey,
	  walletAddress: anchor.web3.PublicKey,
	  splTokenMintAddress: anchor.web3.PublicKey
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
	const getTokenWallet = async (owner: PublicKey,mint: PublicKey) => {
	  return (
	    await PublicKey.findProgramAddress(
	      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
	      ASSOCIATED_TOKEN_PROGRAM_ID
	    )
	  )[0];
	}
	const getMetadata = async (mint: anchor.web3.PublicKey) => {
	  return (
	    await anchor.web3.PublicKey.findProgramAddress(
	      [
	        Buffer.from("metadata"),
	        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
	        mint.toBuffer(),
	      ],
	      TOKEN_METADATA_PROGRAM_ID
	    )
	  )[0];
	}
	async function getDecimalsOfToken(mint : PublicKey){
	  let resp = await conn.getAccountInfo(mint)
	  let accountData = MintLayout.decode(Buffer.from(resp!.data))
	  return accountData.decimals
	}
	async function getNftsForOwner(
	  owner : PublicKey,
	  symbol : string
	  ){
		setIsLoading(true)
	  const allTokens: any = []
	  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(owner, {programId: TOKEN_PROGRAM_ID});
	  console.log("token Accounts", tokenAccounts);
  	const randWallet = new anchor.Wallet(Keypair.generate())
  	const provider = new anchor.Provider(conn,randWallet,confirmOption)
  	const program = new anchor.Program(idl,programId,provider)

	  for (let index = 0; index < tokenAccounts.value.length; index++) {
	    try{
	      const tokenAccount = tokenAccounts.value[index];
	      const tokenAmount = tokenAccount.account.data.parsed.info.tokenAmount;

	      if (tokenAmount.amount == "1" && tokenAmount.decimals == "0") {
			console.log("nft token account", tokenAccount)
	        let nftMint = new PublicKey(tokenAccount.account.data.parsed.info.mint)
	        let pda = await getMetadata(nftMint)
	        const accountInfo: any = await conn.getParsedAccountInfo(pda);
	        let metadata : any = new Metadata(owner.toString(), accountInfo.value)
	        if (metadata.data.data.symbol == symbol) {
			// if (true) {
	          let nD : any = null
	          if(pool != null){
		        	let [nftData, bump] = await PublicKey.findProgramAddress([nftMint.toBuffer(),(new PublicKey(pool)).toBuffer()],programId)
		          if(await conn.getAccountInfo(nftData)){
		          	nD = await program.account.nftData.fetch(nftData)
		          }
	        	}
	        	const { data }: any = await axios.get(metadata.data.data.uri)
	        	const entireData = { ...data, id: Number(data.name.replace( /^\D+/g, '').split(' - ')[0])}
				// console.log("entireData", entireData)
	        	if(entireData.name != null && entireData.symbol) //== symbol && entireData.name == metadata.data.data.name)
		          allTokens.push({
		          	mint : nftMint, metadata : pda, tokenAccount :  tokenAccount.pubkey,
		          	data : metadata.data.data, nftData : nD, offChainData : entireData,
		          })
	        }
	      }
	    } catch(err) {
	      continue;
	    }
	  }
	  console.log("all tokens", allTokens)
	  setHoldingNfts(allTokens)
	  setAirdropAble(canAirdrop())
	  setIsLoading(false)
	  return allTokens
	}

	useEffect(()=>{
		getPoolData()
	},[pool])

	useEffect(()=>{
		if(poolData != null && wallet.publicKey != null){
			getTokenAmount(poolData.rewardMint)
			getNftsForOwner(wallet.publicKey, poolData.stakeCollection)
		}
	},[wallet.publicKey,poolData])

	const getTokenAmount = async (mint : PublicKey) =>{
  	let amount = 0
  	if(wallet!=null && wallet.publicKey!=null){
	  	const tokenAccount = await getTokenWallet(wallet.publicKey, mint)
	  	if(await conn.getAccountInfo(tokenAccount)){
	  		let resp : any = (await conn.getTokenAccountBalance(tokenAccount)).value
	  		amount = Number(resp.uiAmount)
	  	}
  	}
  	setTAmount(amount)
	}

	const getPoolData = async() => {
		try{
			const poolAddress = new PublicKey(pool)
			const randWallet = new anchor.Wallet(Keypair.generate())
    	const provider = new anchor.Provider(conn,randWallet,confirmOption)
    	const program = new anchor.Program(idl,programId,provider)
    	const pD = await program.account.pool.fetch(poolAddress)
    	await getTokenAmount(pD.rewardMint)
    	setPoolData({
    		...pD,
    		period : pD.period.toNumber(),
    		decimals : await getDecimalsOfToken(pD.rewardMint),
    	})
		} catch(err){
			console.log(err)
			setPoolData(null)
		}
	}

	const canAirdrop = () : any => {
		let time = Date.now() / 1000
		if(poolData != null) {
			for(let s of poolData.schedule){
				// console.log(s.airdropTime.toNumber(),"       ",time,"      ",s.airdropTime.toNumber() + poolData.period)
				if(s.airdropTime.toNumber() < time && time < s.airdropTime.toNumber() + poolData.period ){
					return {confirmed : true, start : s.airdropTime.toNumber()}
				}
			}
		}
		return {confirmed : false, start : 0}
	}

	const airdropAll = async() =>{
		try{
			let provider = new anchor.Provider(conn, wallet as any, confirmOption)
		  let program = new anchor.Program(idl,programId,provider)
		  let tokenAccount = await getTokenWallet(wallet.publicKey, poolData.rewardMint)
		  let transaction1 = new Transaction()
		  setAlertState({open: true, message:"Transaction Processing... Please wait for next approve",severity: "warning"})
		  if((await conn.getAccountInfo(tokenAccount)) == null){
		  	transaction1.add(createAssociatedTokenAccountInstruction(tokenAccount,wallet.publicKey,wallet.publicKey,poolData.rewardMint))
		  	try{
		  		await sendTransaction(transaction1,[])
		  		notify('success', 'Token Account Creating Success!');
		  	}catch(err){
		  		console.log(err)
		  		notify('error', 'Failed Token Account Creating Instruction!');
					setAlertState({open: true, message:"Failed! Please try again!",severity:'error'})
		  		return;
		  	}
		  }

		  console.log(holdingNfts)
		  let length = holdingNfts.length
		  let instructions : TransactionInstruction[] = []
		  let j=0
		  let poolAddress = new PublicKey(pool)
		  for(let i=0; i<length; i++){
		  	let nft = holdingNfts[i]
		  	let [nftData, bump] = await PublicKey.findProgramAddress([nft.mint.toBuffer(),poolAddress.toBuffer()],programId)
		  	if(nft.nftData == null){
		  		instructions.push(program.instruction.initNftData(new anchor.BN(bump),{
		  			accounts:{
		  				payer : wallet.publicKey,
		  				pool : poolAddress,
		  				nftMint : nft.mint,
		  				nftData : nftData,
		  				systemProgram : SystemProgram.programId
		  			}
		  		}))
		  		j++;
		  	}
		  	if(j==6 || (i == length-1 && j != 0)){
		  		try{
		  			let transaction = new Transaction()
		  			instructions.map(item=>transaction.add(item))
		  			await sendTransaction(transaction,[])
		  			notify('success', 'Supported Account Creating success!');
		  		}catch(err){
		  			console.log(err)
		  			notify('error', 'Failed Supported Account Creating Instruction!');
		  		}
		  		j=0
		  		instructions = []
		  	}
		  }
		  instructions = []
		  j=0
		  let m = canAirdrop()
		  console.log("---->",m)
		  if(m.confirmed == false) return;
		  let total = 0
		  for(let i=0; i<length; i++){
		  	let nft = holdingNfts[i]
		  	let [nftData, bump] = await PublicKey.findProgramAddress([nft.mint.toBuffer(),poolAddress.toBuffer()],programId)
		  	let nD = await program.account.nftData.fetch(nftData)
		  	if(m.start > nD.lastAirdropTime.toNumber()){
		  		console.log(m.start,"    ",nD.lastAirdropTime.toNumber())
		  		instructions.push(program.instruction.airdrop({
		  			accounts:{
		  				owner : wallet.publicKey,
		  				pool : poolAddress,
		  				nftMint : nft.mint,
		  				nftMetadata : nft.metadata,
		  				nftAccount : nft.tokenAccount,
		  				nftData : nftData,
		  				tokenFrom : poolData.rewardAccount,
		  				tokenTo : tokenAccount,
		  				tokenProgram : TOKEN_PROGRAM_ID,
		  				clock : SYSVAR_CLOCK_PUBKEY
		  			}
		  		}))
		  		j++;
		  		total++;
		  	}
		  	if(j==4 || (i == length-1 && j != 0)){
		  		try{
		  			let transaction = new Transaction()
		  			instructions.map(item=>transaction.add(item))
		  			await sendTransaction(transaction,[])
		  			notify('success', 'Airdrop success!');
		  		}catch(err){
		  			console.log(err)
		  			notify('error', 'Failed Airdrop Instruction!');
		  		}
		  		j=0
		  		instructions=[]
		  	}
		  }
		  if(total == 0){
		  	console.log("already airdrop for all nfts")
		  	notify('warning',"You already airdropped for all nfts")
		  }
		  await getTokenAmount(poolData.rewardMint)
		  setAlertState({open: true, message:"Congratulations!  All transaction Ended!",severity:'success'})
			if(total != 0){
				await getNftsForOwner(wallet.publicKey, poolData.stakeCollection)
			}
		} catch(err) {
			setAlertState({open: true, message:"Failed! Please try again!",severity:'error'})
		}
	}

	async function sendTransaction(transaction : Transaction, signers : Keypair[]) {
		transaction.feePayer = wallet.publicKey
		transaction.recentBlockhash = (await conn.getRecentBlockhash('max')).blockhash;
		await transaction.setSigners(wallet.publicKey,...signers.map(s => s.publicKey));
		if(signers.length != 0) await transaction.partialSign(...signers)
		const signedTransaction = await wallet.signTransaction(transaction);
		let hash = await conn.sendRawTransaction(await signedTransaction.serialize());
		await conn.confirmTransaction(hash);
		return hash
	}

	return <>
		<main className='content'>
			<div className="card">
				<h6 className='card-title'>{"Wallet Balance of Souls : " + tAmount}</h6>
				<form className="form">
					{
						(wallet && wallet.connected) &&
								<button type="button" disabled={isLoading==true || isProcessing==true} className="form-btn" style={{"justifyContent" : "center"}} onClick={async ()=>{
									if(isLoading==false || isProcessing==false){
										setIsProcessing(true)
										await airdropAll()
										setIsProcessing(false)
									}
								}}>
									{ isLoading==false ? ( isProcessing==true ? "Processing..." :"Airdrop") : "Loading..."}
								</button>
					}
					<WalletConnect/>
					<br/>
					<button type="button" className="form-btn" style={{"justifyContent" : "center"}} onClick={async ()=>{
						setTableShow(!tableShow)
					}}>
						{ tableShow==false ? "Show Schedule" : "Hide Schedule"}
					</button>
					<br/>
					{
						poolData!=null && tableShow == true &&
						<>
						<TableContainer component={Paper}>
							<Table sx={{maxWidth : 600}} stickyHeader className="schedule-table" aria-label="simple table">
								<TableHead>
									<TableRow>
										<TableCell>When</TableCell>
										<TableCell>Amount</TableCell>
									</TableRow>
								</TableHead>
								<TableBody>
								{
									(poolData.schedule as any[]).map((item,idx)=>{
										return <TableRow key={idx}>
											<TableCell>{(new Date(item.airdropTime.toNumber()*1000)).toLocaleString()}</TableCell>
											<TableCell>{item.airdropAmount.toNumber()/Math.pow(10, poolData.decimals)}</TableCell>
										</TableRow>
									})
								}
								</TableBody>
							</Table>
						</TableContainer>
						<br/>
						</>
					}
				</form>
			</div>

			<Grid container spacing={1}>
			{
				holdingNfts.map((item, idx)=>{
					return <Grid item xs={2}>
						<Card key={idx} sx={{minWidth : 300}}>
							<CardMedia component="img" height="200" image={item.offChainData.image} alt="green iguana"/>
							<CardContent>
								<Typography gutterBottom variant="h6" component="div">
				        {item.data.name}
				        </Typography>
				        {
				        	(item.nftData == null || (airdropAble.confirmed && airdropAble.start > item.nftData.lastAirdropTime.toNumber())) ?
					        	<Typography variant="body2" color="text.secondary">
					        		You can airdrop with this nft
					        	</Typography>
				        	:
				        		<Typography variant="body2" color="text.secondary">
					        		You have already airdropped with this nft or you are not on airdop time.
					        	</Typography>
				        }
							</CardContent>
						</Card>
					</Grid>
				})
			}
			</Grid>
			<BottomNavigation/>
			<Snackbar
        open={alertState.open}
        autoHideDuration={alertState.severity != 'warning' ? 6000 : 100000}
        onClose={() => setAlertState({ ...alertState, open: false })}
      >
        <Alert
        	iconMapping={{warning : <CircularProgress size={24}/>}}
          onClose={() => setAlertState({ ...alertState, open: false })}
          severity={alertState.severity}
        >
          {alertState.message}
        </Alert>
      </Snackbar>
		</main>
	</>
}