// The contract library: Phil programs for common token mechanics. Each scenario is also a test.
import { LOCKER_SOURCE, HOOKS_SOURCE, VESTING_SOURCE, MULTISIG_SOURCE, AUCTION_SOURCE, LAUNCH_SOURCE } from "./contracts-source";

export interface Scenario { name: string; inputs: Record<string, string>; says: string[] }
export interface Contract {
  id: string; title: string; summary: string; file: string; source: string;
  guarantees: string[];
  /** What an on-chain version would need that this program does not model. */
  port?: string[];
  fields: { key: string; label: string; note?: string; bool?: boolean }[];
  scenarios: Scenario[];
}

export const CONTRACTS: Contract[] = [
  {
    id: "locker", title: "Token locker", file: "contracts/locker.phil", source: LOCKER_SOURCE,
    summary: "Lock tokens for someone with a cliff, a release every period, claiming on demand, and an optional cancel. The same shape as a vesting or streaming service.",
    guarantees: [
      "The sender's share and the recipient's share always add up to exactly what was locked.",
      "Nothing unlocks before the cliff, and the last period releases whatever is left.",
      "A lock created as not cancelable cannot be cancelled: the request is refused and the schedule carries on.",
      "On cancel, everything already unlocked still goes to the recipient.",
    ],
    port: [
      "Real time: periods here are counted steps. On chain they would be read from the clock.",
      "Custody: the locker would be a program-owned token account.",
      "Who may cancel or claim would be checked by signature; here it is fixed by which program holds which end of the protocol.",
    ],
    fields: [
      { key: "total", label: "Tokens locked" }, { key: "periods", label: "Periods", note: "at least 1" }, { key: "cliff", label: "Cliff (periods)", note: "0 means no cliff" },
      { key: "claim_every", label: "Recipient claims every (periods)", note: "at least 1" }, { key: "cancel_at", label: "Sender cancels before period", note: "0 means never" }, { key: "cancelable", label: "Cancelable by the sender", bool: true },
    ],
    scenarios: [
      { name: "Cliff, then monthly", inputs: { total: "1200", periods: "12", cliff: "3", cancelable: "true", cancel_at: "0", claim_every: "1" }, says: ["period 3 recipient claims 300", "period 12 recipient claims 100", "recipient holds 1200", "sender got back 0"] },
      { name: "Cancelled half way", inputs: { total: "1200", periods: "12", cliff: "3", cancelable: "true", cancel_at: "7", claim_every: "4" }, says: ["sender cancelled before period 7", "sender got back 600", "recipient holds 600"] },
      { name: "Cancel refused", inputs: { total: "1200", periods: "12", cliff: "3", cancelable: "false", cancel_at: "7", claim_every: "4" }, says: ["cancel refused", "recipient holds 1200", "sender got back 0"] },
      { name: "Hard lock until the end", inputs: { total: "1000", periods: "12", cliff: "12", cancelable: "false", cancel_at: "0", claim_every: "1" }, says: ["period 12 recipient claims 1000", "recipient holds 1000"] },
    ],
  },
  {
    id: "hooks", title: "Transfer hooks", file: "contracts/hooks.phil", source: HOOKS_SOURCE,
    summary: "Programs that run on every transfer of a token. A limit hook allows or blocks the transfer; a fee hook is handed the tokens, keeps a cut and passes the rest on.",
    guarantees: [
      "A blocked transfer returns every token to the sender, and the later hooks are told to stand down.",
      "A hook that is handed tokens cannot lose any: each one is passed on or kept as its fee.",
      "The token program checks what a hook hands back, so a hook that keeps more than 5% halts the transfer.",
      "What the receiver gets and what the fee hook kept add up to what was sent.",
    ],
    port: [
      "On Solana this is the Token-2022 transfer-hook interface, where a hook can approve or reject but does not take custody; the fee would use the transfer-fee extension.",
      "Hooks here are fixed when the program is wired up. On chain they would be registered on the mint.",
    ],
    fields: [{ key: "amount", label: "Tokens sent" }, { key: "max_transfer", label: "Limit hook: largest transfer allowed" }, { key: "fee_bps", label: "Fee hook: fee (basis points)", note: "at most 500" }],
    scenarios: [
      { name: "Allowed, 1% fee", inputs: { amount: "1000", max_transfer: "5000", fee_bps: "100" }, says: ["fee hook: kept 10", "receiver: received 990", "transfer went through"] },
      { name: "Blocked by the limit", inputs: { amount: "9000", max_transfer: "5000", fee_bps: "100" }, says: ["over the limit of 5000", "nothing arrived", "tokens returned: 9000"] },
      { name: "No fee", inputs: { amount: "1000", max_transfer: "5000", fee_bps: "0" }, says: ["fee hook: kept 0", "receiver: received 1000"] },
    ],
  },
  {
    id: "vesting", title: "Vesting with revocation", file: "contracts/vesting.phil", source: VESTING_SOURCE,
    summary: "A grantor locks tokens in a vault for a beneficiary. They are released in equal parts, one per period, and the grantor may revoke before any period.",
    guarantees: [
      "The beneficiary's share and the grantor's share always add up to the grant.",
      "The last period releases whatever is left, so rounding never strands a token.",
      "The vault can only be retired when it is empty.",
    ],
    fields: [{ key: "total", label: "Tokens granted" }, { key: "periods", label: "Periods", note: "at least 1" }, { key: "revoke_after", label: "Grantor revokes after (periods)", note: "a number above the periods means never" }],
    scenarios: [
      { name: "Vests in full", inputs: { total: "1000", periods: "4", revoke_after: "99" }, says: ["beneficiary holds 1000"] },
      { name: "Revoked after one period", inputs: { total: "1000", periods: "4", revoke_after: "1" }, says: ["grantor revoked after 1 periods", "beneficiary holds 250"] },
      { name: "Uneven split", inputs: { total: "1000", periods: "3", revoke_after: "99" }, says: ["beneficiary holds 1000"] },
      { name: "Revoked at once", inputs: { total: "1000", periods: "4", revoke_after: "0" }, says: ["grantor revoked after 0 periods", "beneficiary holds 0"] },
    ],
  },
  {
    id: "multisig", title: "2-of-3 treasury", file: "contracts/multisig.phil", source: MULTISIG_SOURCE,
    summary: "Three signers vote on one payment from a shared treasury. The vault pays only when at least two approve and the treasury can cover it.",
    guarantees: [
      "Cash can only leave through one function, which requires two approvals and enough funds.",
      "The payment and what stays in the treasury add up to what was there before.",
      "An approved payment the treasury cannot cover is denied, not partly paid.",
    ],
    fields: [
      { key: "funds", label: "Treasury (cash)" }, { key: "amount", label: "Payment proposed" },
      { key: "alice_approves", label: "Alice approves", bool: true }, { key: "bob_approves", label: "Bob approves", bool: true }, { key: "carol_approves", label: "Carol approves", bool: true },
    ],
    scenarios: [
      { name: "Two approve", inputs: { funds: "1000", amount: "300", alice_approves: "true", bob_approves: "true", carol_approves: "false" }, says: ["approvals: 2 of 3", "payee received 300"] },
      { name: "Only one approves", inputs: { funds: "1000", amount: "300", alice_approves: "true", bob_approves: "false", carol_approves: "false" }, says: ["approvals: 1 of 3", "payment denied"] },
      { name: "Approved but not covered", inputs: { funds: "1000", amount: "5000", alice_approves: "true", bob_approves: "true", carol_approves: "true" }, says: ["approved but not covered", "payment denied"] },
    ],
  },
  {
    id: "auction", title: "Sealed-bid auction", file: "contracts/auction.phil", source: AUCTION_SOURCE,
    summary: "A seller hands an item to an auctioneer with a reserve price. Two bidders lock their bids in cash. The higher bid wins if it meets the reserve.",
    guarantees: [
      "The item goes to exactly one party: the winner, or back to the seller.",
      "A losing bid is always refunded in full.",
      "The item only changes hands for a bid that meets the reserve and beats the other bid.",
    ],
    fields: [{ key: "reserve", label: "Reserve price" }, { key: "ann_bid", label: "Ann bids" }, { key: "ben_bid", label: "Ben bids" }],
    scenarios: [
      { name: "Ann wins", inputs: { reserve: "100", ann_bid: "150", ben_bid: "120" }, says: ["won the item for 150", "lost, refunded 120", "seller received 150"] },
      { name: "Ben wins", inputs: { reserve: "100", ann_bid: "90", ben_bid: "130" }, says: ["won the item for 130", "lost, refunded 90", "seller received 130"] },
      { name: "Reserve not met", inputs: { reserve: "100", ann_bid: "50", ben_bid: "60" }, says: ["lost, refunded 50", "lost, refunded 60", "no sale"] },
      { name: "A tie", inputs: { reserve: "100", ann_bid: "120", ben_bid: "120" }, says: ["won the item for 120", "lost, refunded 120"] },
    ],
  },
  {
    id: "launch", title: "Bonding-curve launch", file: "contracts/launch.phil", source: LAUNCH_SOURCE,
    summary: "Tokens are minted along a rising price curve. If the whole supply sells in time the launch graduates and seeds a liquidity pool. If not, the buyer is refunded in full.",
    guarantees: [
      "Tokens are only minted against exactly the quoted cash.",
      "On graduation the pool receives the whole reserve.",
      "On failure the buyer returns every token and gets every unit of cash back.",
    ],
    fields: [
      { key: "supply", label: "Supply to sell", note: "at most 1,000,000" }, { key: "base", label: "Starting price" }, { key: "slope", label: "Price rise per token sold", note: "at most 1000" },
      { key: "rounds", label: "Rounds before it fails", note: "at most 50" }, { key: "per_round", label: "Buyer buys per round" }, { key: "wallet", label: "Buyer's wallet (cash)" },
    ],
    scenarios: [
      { name: "Graduates", inputs: { supply: "1000", base: "10", slope: "1", rounds: "10", per_round: "250", wallet: "1000000" }, says: ["graduated with a reserve of 509500", "pool opened with 509500 cash and 1000 tokens", "buyer holds 1000 tokens and 490500 cash"] },
      { name: "Runs out of time", inputs: { supply: "1000", base: "10", slope: "1", rounds: "3", per_round: "250", wallet: "1000000" }, says: ["launch failed after 3 rounds", "buyer refunded, cash back to 1000000"] },
      { name: "Buyer runs out of cash", inputs: { supply: "1000", base: "10", slope: "1", rounds: "10", per_round: "250", wallet: "100000" }, says: ["launch failed after 10 rounds", "buyer refunded, cash back to 100000"] },
    ],
  },
];
