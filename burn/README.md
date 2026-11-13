# Burn vault

A vault on Solana that turns a coin's fees into burned supply. Any coin can have one.

**The rule.** A vault is opened for one coin with one number, the threshold. Whoever burns
`threshold` of that coin receives all the SOL the vault holds above its rent reserve. Nothing
else can take SOL out: the program has two instructions, OPEN and BURN, and no owner.

**Why this burns fees.** When the pot is worth more than `threshold` coins cost on the market,
buying the coins, burning them and taking the pot is profitable, so someone does it. The fees
have then bought coins off the market and destroyed them. The vault never trades, so it does
not depend on any exchange and no bot holds the money.

| File | What it is |
|---|---|
| `runtime.c` | The program: the runtime Phil's upload server calls (shared in spirit with `giveaway/runtime.c`), the vault's two actions, and the entry point |
| `run.ts` | Opens vaults, runs the self-test against the real token program, and runs the demonstration coin |
| `program.json`, `vaults.json`, `demo.json` | The deployed program, the vaults opened with it, and the demonstration coin's history |

It is built with `giveaway/build.sh burn/out/phil_burn.so burn/runtime.c`, from the same
emitted Phil LLVM as the giveaway program (`giveaway/phil-llvm/`).

## The two instructions

Both are uploads through `UploadServer`, the function Phil's LLVM backend emits, in the frame
format of Phil's control codec v1. Phil's server checks the handshake, the policy, and that the
uploaded bytes match their declared SHA-256. If it accepts, the "store" step acts.

**OPEN** — accounts: the vault (a new 256-byte account owned by the program).
Upload kind `phil-burn/open`, record: `"BURN1"`, mint (32 bytes), threshold (u64, smallest
units), label length, label. The lamports in the account at that moment become its reserve.
Create the account and open it in one transaction.

**BURN** — accounts: vault, the coin's mint, the sender's token account, the sender (signer),
the token program. Upload kind `phil-burn/offer`, record: `"BOFF1"`, the least the sender will
accept (u64 lamports). The program checks the mint is the vault's, the token program is one of
Solana's two and is the one that owns the mint, and the sender signed. It then calls the token
program's `Burn` for the threshold, and only after that succeeds moves the pot to the sender.
Any failure fails the whole transaction.

## Limits

- **It needs someone to act.** With one actor and no competition, that actor can let the pot
  grow well past the cost of the coins and keep the difference. A project should take the pot
  itself whenever it covers the cost; anyone may compete.
- **SOL only.** Fees in other tokens are not handled.
- **The threshold is fixed in coins**, forever.
- **Devnet, unaudited.** Tested natively (`npm run test:burn`), on a local validator and on
  devnet against the real token program. Not reviewed by anyone independent, and not deployed
  on mainnet. It should not hold real money before a review.
- The vault and its payout logic are ours. Phil's part is the gatekeeping: `UploadServer`.
