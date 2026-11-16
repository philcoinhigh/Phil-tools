// Proves the snowball on higher.fun's devnet setup: a coin whose creator is a burn vault's own
// address, so its creator fees can only ever be rolled into the vault and paid to whoever burns.
//
//   higher <rpc> <burn program id> <payer.json> <record.json>
//
// higher.fun launches on Raydium LaunchLab with its own platform settings. This uses the same
// program and the same settings on devnet (addresses from higher.fun's web bundle, as recorded in
// github.com/HigherMaestro/highwire). It is not run by, or endorsed by, higher.fun.
import * as fs from "fs";
import BN from "bn.js";
import { Raydium, TxVersion, LaunchpadPool, getPdaLaunchpadPoolId } from "@raydium-io/raydium-sdk-v2";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { decodeVault, potOf, VAULT_SIZE } from "../site/src/burn";
import { openInstructions, burnInstruction, rollInstruction, creatorAddress, creatorFeeVault, LAUNCHLAB, WSOL_MINT, TOKEN_PROGRAM, ATA_PROGRAM } from "../site/src/burn-tx";

const HIGHER_DEVNET = {
  launchLabAuth: new PublicKey("5xqNaZXX5eUi4p5HU4oz9i5QnwRNT2y6oN7yyn4qENeq"),
  launchLabSolConfig: new PublicKey("7ZR4zD7PYfY2XxoG1Gxcy2EgEeGYrpxrwzPuwdUBssEt"),
  rewardsPlatform: new PublicKey("5YMKfjGk6sigE6baKyGGCHDQjJTEHHVLSF3cXNvLKKfJ"),      // "New school": the creator earns 0.25% of each trade
  launchConfigs: "https://launch-mint-v1-devnet.raydium.io/main/configs",
};
const INITIALIZE_V2 = "4399af27da102620";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const [url, programText, payerFile, recordFile] = process.argv.slice(2);
const conn = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
const program = new PublicKey(programText), launchlab = LAUNCHLAB.devnet;
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerFile, "utf8"))));
const note = (...a: unknown[]) => console.error(...a);

async function patiently<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await f(); } catch (e: any) { if (i >= 9 || !/429|Too Many|fetch failed|ECONNRESET|ETIMEDOUT|503|502|socket hang up/i.test(String(e?.message ?? e))) throw e; await sleep(1500 * (i + 1)); }
  }
}
/** Sends once, confirms by slow polling, and throws with the program's logs if it fails. */
async function send(what: string, ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.recentBlockhash = (await patiently(() => conn.getLatestBlockhash("confirmed"))).blockhash; tx.feePayer = signers[0].publicKey; tx.sign(...signers);
  const raw = tx.serialize();
  let signature: string;
  try { signature = await patiently(() => conn.sendRawTransaction(raw, { preflightCommitment: "confirmed" })); }
  catch (e: any) { throw new Error(`${what} was refused: ${String(e?.message ?? e).split("\n")[0]}\n${(e?.logs ?? e?.transactionLogs ?? []).join("\n")}`); }
  for (let i = 0; ; i++) {
    await sleep(1600);
    const st = (await patiently(() => conn.getSignatureStatuses([signature]))).value[0];
    if (st?.err) throw new Error(`${what} failed on chain: ${JSON.stringify(st.err)} (${signature})`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") break;
    if (i >= 50) throw new Error(`${what} was not confirmed in time (${signature})`);
  }
  note(`ok   ${what}: ${signature}`);
  return signature;
}
const ataOf = (owner: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
const tokenBalance = async (account: PublicKey): Promise<bigint> => { try { return BigInt((await patiently(() => conn.getTokenAccountBalance(account, "confirmed"))).value.amount); } catch { return 0n; } };
const instructionsOf = (tx: unknown): TransactionInstruction[] => { if (!(tx instanceof Transaction)) throw new Error("expected a legacy transaction from Raydium's SDK"); return tx.instructions; };

async function main() {
  const raydium = await Raydium.load({ connection: conn, owner: payer, cluster: "devnet", disableLoadToken: true, disableFeatureCheck: true, blockhashCommitment: "confirmed" });
  // The SDK's only HTTP read that a launch needs is LaunchLab's default curve; everything else comes from the chain.
  const api = raydium.api as unknown as Record<string, unknown>;
  api.fetchLaunchConfigs = async () => ((await (await fetch(HIGHER_DEVNET.launchConfigs, { headers: { accept: "application/json" } })).json()) as any).data.data;
  api.getTokenInfo = async () => [];
  api.getChainTimeOffset = async () => ({ offset: 0 });

  // 1. A burn vault for a coin that does not exist yet, and the one address that will be the coin's creator.
  const mint = Keypair.generate();
  const THRESHOLD = 1_000_000n * 1_000_000n;                                   // burn a million coins to take the pot
  const rent = await patiently(() => conn.getMinimumBalanceForRentExemption(VAULT_SIZE));
  const made = openInstructions({ program, payer: payer.publicKey, mint: mint.publicKey, threshold: THRESHOLD, label: "higher.fun devnet", rentLamports: rent });
  const vault = made.vault.publicKey, creator = creatorAddress(program, vault).address;
  const opened = await send("open the vault and fund its creator address", [...made.instructions, SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: creator, lamports: 4_000_000 })], [payer, made.vault]);

  // 2. Launch the coin on higher.fun's devnet platform, with the vault's address as its creator. The creator does not sign.
  const created = await raydium.launchpad.createLaunchpad({
    programId: launchlab, authProgramId: HIGHER_DEVNET.launchLabAuth, platformId: HIGHER_DEVNET.rewardsPlatform, configId: HIGHER_DEVNET.launchLabSolConfig,
    mintA: mint.publicKey, decimals: 6, mintBDecimals: 9, name: "Snowball demo", symbol: "SNOWD", uri: "https://philcoinhigh.github.io/Phil-tools/burn/",
    migrateType: "cpmm", buyAmount: new BN(0), createOnly: true, slippage: new BN(1000), extraSigners: [mint], feePayer: payer.publicKey, txVersion: TxVersion.LEGACY,
  } as any);
  const createTxs = ((created as any).transactions ?? [(created as any).transaction]) as unknown[];
  let patched = 0;
  const createIxs = createTxs.flatMap(instructionsOf);
  for (const ix of createIxs) {
    if (!ix.programId.equals(launchlab) || ix.data.subarray(0, 8).toString("hex") !== INITIALIZE_V2) continue;
    if (!ix.keys[1].pubkey.equals(payer.publicKey)) throw new Error("the launch does not have the expected creator account");
    ix.keys[1] = { pubkey: creator, isSigner: false, isWritable: ix.keys[1].isWritable }; patched++;
  }
  if (patched !== 1) throw new Error(`expected one coin creation, found ${patched}`);
  const launched = await send("launch the coin with the vault's address as creator", createIxs, [payer, mint]);
  const poolId = getPdaLaunchpadPoolId(launchlab, mint.publicKey, WSOL_MINT).publicKey;
  const poolInfo = await patiently(() => conn.getAccountInfo(poolId, "confirmed"));
  if (!poolInfo) throw new Error("the coin's curve was not found after launching");
  const pool = LaunchpadPool.decode(poolInfo.data);
  if (!pool.creator.equals(creator)) throw new Error(`the curve names ${pool.creator.toBase58()} as creator, not the vault's address`);
  note(`ok   LaunchLab records the vault's address as the coin's creator: ${creator.toBase58()}`);

  // 3. Trade it. Each buy pays the creator fee into LaunchLab's fee vault for that creator.
  const buy = await raydium.launchpad.buyToken({ programId: launchlab, authProgramId: HIGHER_DEVNET.launchLabAuth, mintA: mint.publicKey, buyAmount: new BN(150_000_000), slippage: new BN(2000), feePayer: payer.publicKey, txVersion: TxVersion.LEGACY } as any);
  const bought = await send("buy 0.15 SOL of the coin", instructionsOf((buy as any).transaction), [payer, ...(((buy as any).signers ?? []) as Keypair[])]);
  const feeVault = creatorFeeVault(launchlab, creator);
  const waiting = await tokenBalance(feeVault);
  if (waiting <= 0n) throw new Error("the buy paid no creator fee: is this platform setting still New school?");
  note(`ok   creator fees waiting in LaunchLab's vault for that address: ${waiting} lamports`);

  // 4. ROLL. Sent by a key with no special rights: the fees can only go into the vault.
  const stranger = Keypair.generate();
  await send("fund a stranger", [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: stranger.publicKey, lamports: 3_000_000 })], [payer]);
  const before = BigInt(await patiently(() => conn.getBalance(vault, "confirmed"))), creatorBefore = BigInt(await patiently(() => conn.getBalance(creator, "confirmed")));
  const rolled = await send("roll the creator fees into the vault, sent by a stranger", [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), rollInstruction(program, vault, launchlab)], [stranger]);
  const after = BigInt(await patiently(() => conn.getBalance(vault, "confirmed"))), creatorAfter = BigInt(await patiently(() => conn.getBalance(creator, "confirmed")));
  const v = decodeVault(Uint8Array.from((await patiently(() => conn.getAccountInfo(vault, "confirmed")))!.data))!;
  if (after - before !== waiting || v.rolled !== waiting) throw new Error(`the vault gained ${after - before} lamports and records ${v.rolled}, but ${waiting} were waiting`);
  if (creatorAfter !== creatorBefore) throw new Error("the creator address kept or lost lamports in the roll");
  if ((await tokenBalance(feeVault)) !== 0n) throw new Error("fees were left behind in LaunchLab's vault");
  note(`ok   every lamport of the creator fees is in the vault: ${waiting}`);

  // 5. BURN. Whoever burns the coin takes the pot: here the buyer burns a million of what it bought.
  const tokens = ataOf(payer.publicKey, mint.publicKey), held = await tokenBalance(tokens);
  if (held < THRESHOLD) throw new Error(`the buy returned ${held} units, less than the vault's rule needs`);
  const pot = potOf(after, v);
  const burned = await send("burn a million coins and take the pot", [burnInstruction({ program, vault, mint: mint.publicKey, tokens, sender: payer.publicKey, tokenProgram: TOKEN_PROGRAM, leastLamports: pot })], [payer]);
  const left = await tokenBalance(tokens);
  if (held - left !== THRESHOLD) throw new Error("the burn did not burn exactly the vault's rule");
  note(`ok   ${THRESHOLD / 1_000_000n} coins burned for a pot of ${pot} lamports, all of it creator fees`);

  const record = { day: new Date().toISOString().slice(0, 10), network: "devnet", program: program.toBase58(), launchlab: launchlab.toBase58(), platform: HIGHER_DEVNET.rewardsPlatform.toBase58(),
    vault: vault.toBase58(), creator: creator.toBase58(), mint: mint.publicKey.toBase58(), pool: poolId.toBase58(), boughtLamports: "150000000", feeLamports: waiting.toString(), potLamports: pot.toString(),
    burnedUnits: THRESHOLD.toString(), signatures: { opened, launched, bought, rolled, burned } };
  fs.writeFileSync(recordFile, JSON.stringify(record, null, 1) + "\n");
  console.log(JSON.stringify({ ok: true, ...record }, null, 1));
}
main().catch((e) => { note("FAIL " + String(e?.message ?? e)); process.exit(1); });
